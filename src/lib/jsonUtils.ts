/**
 * Robustly extracts and repairs JSON from a string that might contain 
 * markdown, extra text, or be truncated.
 */
export function robustParseJson(text: string, fallback: any = {}): any {
  if (!text) return fallback;

  try {
    // 1. Basic cleanup
    let jsonStr = text.replace(/```json\n?|```/g, "").trim();
    
    // 2. Find the JSON boundaries
    const startIdx = jsonStr.indexOf("{");
    const endIdx = jsonStr.lastIndexOf("}");
    
    if (startIdx === -1) {
      // If no { found, maybe it's an array?
      const arrayStart = jsonStr.indexOf("[");
      const arrayEnd = jsonStr.lastIndexOf("]");
      if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
        jsonStr = jsonStr.substring(arrayStart, arrayEnd + 1);
      } else {
        return fallback;
      }
    } else if (endIdx !== -1 && endIdx > startIdx) {
      jsonStr = jsonStr.substring(startIdx, endIdx + 1);
    } else if (endIdx === -1 || endIdx <= startIdx) {
      // Truncated case: starts with { but no }
      jsonStr = jsonStr.substring(startIdx);
    }

    // 3. Advanced repairs
    let repairedJson = jsonStr;

    // Fix missing commas between objects/arrays
    repairedJson = repairedJson.replace(/\}\s*\{/g, '}, {');
    repairedJson = repairedJson.replace(/\]\s*\[/g, '], [');

    // Fix trailing commas
    repairedJson = repairedJson.replace(/,\s*\}/g, '}');
    repairedJson = repairedJson.replace(/,\s*\]/g, ']');

    // Handle unterminated strings and missing closing braces
    if (repairedJson.includes('"')) {
      // Count quotes to see if they are balanced
      const quoteCount = (repairedJson.match(/"/g) || []).length;
      if (quoteCount % 2 !== 0) {
        // If we're at the end of the string, it might be truncated
        // We need to close the quote, but only if it makes sense
        repairedJson += '"';
      }
    }

    // Balance braces and brackets in the correct order
    const stack: string[] = [];
    for (let i = 0; i < repairedJson.length; i++) {
      if (repairedJson[i] === '{') stack.push('}');
      else if (repairedJson[i] === '[') stack.push(']');
      else if (repairedJson[i] === '}' || repairedJson[i] === ']') {
        if (stack.length > 0 && stack[stack.length - 1] === repairedJson[i]) {
          stack.pop();
        }
      }
    }
    
    // Close everything in reverse order
    while (stack.length > 0) {
      repairedJson += stack.pop();
    }

    try {
      return JSON.parse(repairedJson);
    } catch (e) {
      // One last ditch effort: if it's still failing, try to just return what we have
      // by stripping everything after the last valid-looking closing character
      console.warn("JSON parse failed after repair, trying minimal recovery:", e);
      return fallback;
    }
  } catch (e) {
    console.error("Critical error in robustParseJson:", e);
    return fallback;
  }
}
