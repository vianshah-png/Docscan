// app.js

const uploadArea = document.getElementById('uploadArea');
const loadingArea = document.getElementById('loadingArea');
const resultsArea = document.getElementById('resultsArea');
const fileInput = document.getElementById('fileInput');
const canvas = document.getElementById('canvas');
const statusLog = document.getElementById('statusLog');

// Tab logic
function switchTab(tabId) {
  const targetTab = document.getElementById(tabId);
  const targetNav = document.querySelector(`.tab[data-target="${tabId}"]`);
  
  if (targetNav.classList.contains('disabled')) return;

  // Deactivate all
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));

  // Activate target
  targetTab.classList.add('active');
  targetNav.classList.add('active');
}

// Elements
const ocrCard = document.getElementById('ocrCard');
const ocrResult = document.getElementById('ocrResult');
const auditLoader = document.getElementById('auditLoader');
const auditContent = document.getElementById('auditContent');
const tabNavAudit = document.getElementById('tabNavAudit');
const tabNavChemists = document.getElementById('tabNavChemists');
const chemistPrompt = document.getElementById('chemistPrompt');
const pharmacyLoader = document.getElementById('pharmacyLoader');
const pharmacyList = document.getElementById('pharmacyList');

let currentBase64 = null;

function log(msg) {
  const p = document.createElement('div');
  p.textContent = `> ${msg}`;
  statusLog.appendChild(p);
  statusLog.scrollTop = statusLog.scrollHeight;
}

function handleImage(input) {
  const file = input.files[0];
  if (!file) return;

  log(`Loaded file: ${file.name}`);
  uploadArea.style.display = 'none';
  loadingArea.style.display = 'block';

  // Compress
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      const MAX_WIDTH = 1200;
      const MAX_HEIGHT = 1200;
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
      } else {
        if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
      }
      canvas.width = width;
      canvas.height = height;
      
      // Basic contrast enhancement
      ctx.filter = 'contrast(1.2) brightness(1.05) saturate(0.5)';
      ctx.drawImage(img, 0, 0, width, height);

      currentBase64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
      document.getElementById('previewImg').src = `data:image/jpeg;base64,${currentBase64}`;
      log('Image compressed, ready for OCR.');

      processPrescription(currentBase64);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function processPrescription(base64Image) {
  try {
    log('Sending to OCR Stream...');
    
    // Stage 1: Stream text
    const res1 = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64Image, type: 'stream' })
    });
    
    const reader1 = res1.body.getReader();
    const decoder1 = new TextDecoder('utf-8');
    let ocrText = '';
    
    while(true) {
      const {done, value} = await reader1.read();
      if(done) break;
      const chunk = decoder1.decode(value);
      ocrText += chunk;
      log(chunk.substring(0, 100) + '...');
    }

    // Done with stream, clean up the response Text.
    const cleanOcr = ocrText.replace(/\[System\].*\n/g, '').trim();

    // Show Stream result First - jump to OCR Tab
    loadingArea.style.display = 'none';
    resultsArea.style.display = 'block';
    ocrResult.textContent = cleanOcr || 'No text found in scan.';

    // Enable Audit Tab, switch to OCR Tab explicitly
    tabNavAudit.classList.remove('disabled');
    
    // Stage 2: Deep Audit in BACKGROUND
    log('OCR complete. Sending for Deep Audit automatically in background...');
    
    const res2 = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64Image, ocrText, type: 'audit' })
    });

    const reader2 = res2.body.getReader();
    const decoder2 = new TextDecoder('utf-8');
    let auditRaw = '';
    
    while(true) {
      const {done, value} = await reader2.read();
      if(done) break;
      auditRaw += decoder2.decode(value);
    }
    
    log('Audit complete.');
    let auditData;
    
    try {
      // Find JSON block more robustly
      const startIndex = auditRaw.indexOf('{');
      const endIndex = auditRaw.lastIndexOf('}');
      if (startIndex !== -1 && endIndex !== -1) {
        const cleanJson = auditRaw.substring(startIndex, endIndex + 1);
        try {
          auditData = JSON.parse(cleanJson);
        } catch (parseErr) {
            console.error("JSON parse error:", parseErr, "Cleaned JSON segment:", cleanJson);
            throw new Error(`JSON format is invalid. ${parseErr.message}`);
        }
      } else {
        // If we have an [Error] message from the backend, log that too
        const serverError = auditRaw.match(/\[Error\](.*)/);
        if (serverError) {
          throw new Error(`Backend Error: ${serverError[1].trim()}`);
        }
        throw new Error("No JSON object found in response");
      }
    } catch(e) {
      console.error(e, auditRaw);
      auditLoader.innerHTML = `<div style="color:var(--danger)"><strong>Analysis Failed:</strong> ${e.message}. Wait a few seconds and try again.</div>`;
      return;
    }

    renderResults(auditData);

  } catch(err) {
    console.error(err);
    alert('An error occurred. Check console logs.');
  }
}

function renderResults(data) {
  auditLoader.style.display = 'none';
  auditContent.style.display = 'grid';
  tabNavChemists.classList.remove('disabled'); // Enable finding chemists

  // The user can now switch to the Audit tab, or we can auto-switch to it
  // switchTab('tab-audit'); 
  
  document.getElementById('clinicName').textContent = data.clinicName || 'Clinic Info';
  document.getElementById('valPatient').textContent = data.patientName || 'Unknown';
  document.getElementById('valDoctor').textContent = data.doctorName || 'Unknown';
  document.getElementById('valDate').textContent = data.date || 'Unknown';

  if (data.overallSafetyWarnings && data.overallSafetyWarnings.length > 0) {
    const oaw = document.getElementById('overallWarnings');
    oaw.style.display = 'block';
    const ul = document.getElementById('warningsList');
    ul.innerHTML = '';
    data.overallSafetyWarnings.forEach(w => {
      const li = document.createElement('li');
      li.textContent = w;
      ul.appendChild(li);
    });
  }

  const medList = document.getElementById('medicationsList');
  medList.innerHTML = '';
  if (data.medications) {
    data.medications.forEach(m => {
      const div = document.createElement('div');
      div.className = 'med-item';
      
      let html = `
        <div class="med-header">
          <div class="med-name">${m.drugName}</div>
          <div class="badge">${(m.confidence * 100).toFixed(0)}% Conf</div>
        </div>
        <div class="details-grid">
          <div><strong>Dosage:</strong> ${m.dosage || '-'}</div>
          <div><strong>Frequency:</strong> ${m.frequency || '-'}</div>
        </div>
      `;

      if (m.activeIngredients && m.activeIngredients.length) {
        html += `<div class="pill-list">${m.activeIngredients.map(a => `<span class="pill">${a}</span>`).join('')}</div>`;
      }

      if (m.safetyWarnings && m.safetyWarnings.length) {
          html += `<div class="warning-box">${m.safetyWarnings.join('<br>')}</div>`;
      }

      if (m.alternatives && m.alternatives.length) {
        html += `<div style="margin-top:1rem;font-size:0.85rem"><strong>Alternatives:</strong> ${m.alternatives.map(a => a.brandName).join(', ')}</div>`;
      }

      div.innerHTML = html;
      medList.appendChild(div);
    });
  }
}

function findPharmacies() {
  if (!navigator.geolocation) {
    alert("Geolocation is not supported by your browser");
    return;
  }
  
  chemistPrompt.style.display = 'none';
  pharmacyLoader.style.display = 'block';
  pharmacyList.innerHTML = '';
  
  navigator.geolocation.getCurrentPosition(async (pos) => {
    try {
      const res = await fetch('/api/pharmacies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      });
      
      const text = await res.text();
      let list = [];
      
      // Robust extraction: skip the [System] prefix and find the FIRST '[' that starts the array
      const dataStartIndex = text.indexOf('\n['); // Usually follows the prefix newline
      const startIndex = dataStartIndex !== -1 ? dataStartIndex + 1 : text.indexOf('[');
      const endIndex = text.lastIndexOf(']');
      
      if (startIndex !== -1 && endIndex !== -1 && startIndex < endIndex) {
        const cleanJson = text.substring(startIndex, endIndex + 1);
        try {
          list = JSON.parse(cleanJson);
        } catch (parseErr) {
          console.error("Pharmacy JSON parse error:", parseErr, cleanJson);
          throw new Error("Invalid pharmacy data received.");
        }
      } else {
        throw new Error("No pharmacy data found in response");
      }

      pharmacyLoader.style.display = 'none';
      
      if (list.length === 0) {
        pharmacyList.innerHTML = '<div style="text-align:center; padding:2rem; color:var(--text-muted)">No nearby chemists found in this area.</div>';
        return;
      }
      
      list.forEach(p => {
        const div = document.createElement('div');
        div.className = 'pharmacy-card';
        const waLink = p.phone ? `https://wa.me/${p.phone.replace(/[^0-9]/g, '')}?text=Hi, I have a prescription to check availability.` : '#';
        const smsLink = p.phone ? `sms:${p.phone.replace(/[^0-9]/g, '')}` : '#';

        div.innerHTML = `
          <div class="pharmacy-dist">${p.distance}</div>
          <div class="pharmacy-name">${p.name}</div>
          <div class="pharmacy-addr">${p.address}</div>
          <div style="font-size:0.8rem;margin-bottom:0.5rem">⭐ ${p.rating || 'N/A'} | 📞 ${p.phone || 'No phone'}</div>
          <div class="action-links">
            <a href="${p.mapsUrl}" target="_blank">🗺️ Maps</a>
            ${p.phone ? `<a href="${waLink}" target="_blank">💬 WhatsApp</a> <a href="${smsLink}">📱 SMS</a>` : ''}
            ${p.email ? `<a href="mailto:${p.email}">📧 Email</a>` : ''}
          </div>
        `;
        pharmacyList.appendChild(div);
      });
    } catch (e) {
      console.error(e);
      pharmacyLoader.innerHTML = `<div style="color:red; text-align: center;">Failed to load chemists.</div>`;
    }
  }, (err) => {
    alert("Location access denied or failed.");
    pharmacyLoader.style.display = 'none';
    chemistPrompt.style.display = 'block';
  });
}
