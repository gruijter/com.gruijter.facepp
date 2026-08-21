/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */
/* eslint-disable no-use-before-define */

/*
Copyright 2020 - 2026, Robin de Gruijter (gruijter@hotmail.com)

This file is part of com.gruijter.facepp.

com.gruijter.facepp is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

com.gruijter.facepp is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with com.gruijter.facepp.  If not, see <http://www.gnu.org/licenses/>.
*/

'use strict';

function errMsg(err) {
  return (err && err.message) || String(err);
}

// tab 2 stuff here
function displayLogs(lines) {
  document.getElementById('loglines').textContent = lines;
}

function updateLogs() {
  displayLogs('');
  const showLogs = document.getElementById('show_logs').checked;
  const showErrors = document.getElementById('show_errors').checked;
  const showNoDetects = document.getElementById('show_no_detections').checked;
  Homey.api('GET', 'getlogs/', null, (err, result) => {
    if (err) {
      displayLogs(errMsg(err));
      return;
    }
    const lines = result
      .slice()
      .reverse()
      .filter((line) => (showLogs || !line.includes('[log]'))
    && (showErrors || !line.includes('[err]'))
    && (showNoDetects || !line.includes(' found in image')))
      .map((line) => line.replace(' [FaceApp]', ''));
    displayLogs(lines.join('\n'));
  });
}

function deleteLogs() {
  Homey.confirm(Homey.__('settings.tab2.deleteWarning'), 'warning', (error, result) => {
    if (error || !result) return;
    Homey.api('GET', 'deletelogs/', null, (err) => {
      if (err) {
        Homey.alert(errMsg(err), 'error');
        return;
      }
      Homey.alert(Homey.__('settings.tab2.deleted'), 'info');
      updateLogs();
    });
  });
}

// tab 3 stuff here
function checkKeys() {
  Homey.get('settingsKey', (error, set) => {
    if (error || !set) {
      Homey.alert(Homey.__('settings.tab3.keyNotSaved'), 'error');
      return;
    }
    if (!set.apiKey || set.apiKey.length < 10 || !set.apiSecret || set.apiSecret.length < 10) {
      Homey.alert(Homey.__('settings.tab3.keyInvalid'), 'error');
    }
  });
}

function showInfo3() {
  document.getElementById('apiSecret').type = 'password';
  Homey.get('settingsKey', (err, set) => {
    if (err || !set) return;
    document.getElementById('apiKey').value = set.apiKey;
    document.getElementById('apiSecret').value = set.apiSecret;
  });
  Homey.get('settingsMatch', (err, set) => {
    if (err || !set) return;
    document.getElementById('threshold').value = set.threshold;
  });
  Homey.get('cropEnabled', (err, value) => {
    if (err) return;
    // undefined (never saved before) means the default: enabled
    document.getElementById('cropEnabled').checked = value !== false;
  });
}

function togglePasswordView() {
  const x = document.getElementById('apiSecret');
  x.type = x.type === 'password' ? 'text' : 'password';
}

async function saveSettingsKey() {
  try {
    const apiKey = document.getElementById('apiKey').value;
    const apiSecret = document.getElementById('apiSecret').value;
    await Homey.set('settingsKey', { apiKey, apiSecret });
    // verify the key actually works against Face++ before telling the user it's good
    await new Promise((resolve, reject) => {
      Homey.api('POST', 'testapikey/', { apiKey, apiSecret }, (err) => {
        if (err) return reject(err);
        return resolve();
      });
    });
    Homey.alert(Homey.__('settings.tab3.keySaved'), 'info');
  } catch (error) {
    Homey.alert(Homey.__('settings.tab3.keyInvalid'), 'error');
  }
}

async function saveSettingsMatch() {
  try {
    const threshold = document.getElementById('threshold').value;
    if (threshold < 0 || threshold > 100) throw Error(Homey.__('settings.tab3.thresholdInvalid'));
    await Homey.set('settingsMatch', { threshold });
    Homey.alert(Homey.__('settings.tab3.matchSaved'), 'info');
  } catch (error) {
    Homey.alert(errMsg(error), 'error');
  }
}

async function saveSettingsCrop() {
  try {
    const cropEnabled = document.getElementById('cropEnabled').checked;
    await Homey.set('cropEnabled', cropEnabled);
    Homey.alert(Homey.__('settings.tab3.matchSaved'), 'info');
  } catch (error) {
    Homey.alert(errMsg(error), 'error');
  }
}

// tab 4 stuff here
let faceSet = {};
let faceInfo = {};

function getFaceSet() {
  return new Promise((resolve, reject) => {
    Homey.get('face_set', (err, set) => {
      if (err) return reject(err);
      faceSet = set || {};
      return resolve(faceSet);
    });
  });
}

function clearInfo() {
  document.getElementById('faceToken').value = '';
  document.getElementById('facequality').value = 0;
  document.getElementById('gender').value = '';
  document.getElementById('age').value = 0;
  document.getElementById('glass').value = '';
  document.getElementById('addedAt').value = '';
}

function showInfo(face, detected) {
  // add new face; disable save, enable photo upload, clear label
  if (!face || !face.face_token) {
    document.getElementById('label').value = '';
    document.getElementById('file').style.display = '';
    document.getElementById('preview').src = '';
    document.getElementById('saveFace').disabled = true;
    document.getElementById('deleteFace').disabled = true;
    clearInfo();
    return;
  }
  // newly detected, unsaved face; enable save, enable upload photo
  if (detected) {
    document.getElementById('file').style.display = '';
    document.getElementById('saveFace').disabled = false;
    document.getElementById('deleteFace').disabled = true;
  }
  // existing face: load image, load label, disable upload photo
  if (!detected) {
    document.getElementById('file').style.display = 'none';
    document.getElementById('saveFace').disabled = false;
    document.getElementById('deleteFace').disabled = false;
    document.getElementById('label').value = face.label;
    // a face fetched from another Homey has no local photo - Face++ never stores the
    // original image, only this Homey's own /userdata/<token>.img (if it exists) does
    document.getElementById('preview').src = face.imported ? '../assets/icon.svg' : `../userdata/${face.face_token}.img`;
  }
  document.getElementById('faceToken').value = face.face_token;
  // an imported face normally has real attributes (fetched via face/analyze during
  // import - see fetchForeignFaces()), but that batch call can fail independently of
  // the import itself, and very old locally-added entries may predate this field
  // entirely - never let a missing attributes object break the rest of the form
  const attributes = face.attributes || {};
  document.getElementById('facequality').value = attributes.facequality ? attributes.facequality.value : '';
  document.getElementById('gender').value = attributes.gender ? attributes.gender.value : '';
  document.getElementById('age').value = attributes.age ? attributes.age.value : '';
  document.getElementById('glass').value = attributes.glass ? attributes.glass.value : '';
  // older/imported faces may predate the addedAt field entirely - just show blank
  document.getElementById('addedAt').value = face.addedAt ? new Date(face.addedAt).toLocaleString() : '';
}

function faceSelected() {
  const selectedFace = document.getElementById('faceList').value;
  faceInfo = faceSet[selectedFace] || {};
  showInfo(faceInfo);
}

// function to populate the dropdown list
async function fillDropdown() {
  const dropDown = document.getElementById('faceList');
  while (dropDown.length > 0) {
    dropDown.remove(dropDown.length - 1);
  }
  // add an empty item in the dropdown list
  const newOption = document.createElement('option');
  newOption.text = Homey.__('settings.tab4.newFace');
  newOption.value = null;
  dropDown.add(newOption);
  faceSet = await getFaceSet();
  // manually managed faces first (in their existing order), then auto-added ones
  // (settings.tab4 "Auto-add Faces"), oldest-added first, so the ones still awaiting
  // review sort together at the end instead of being mixed in alphabetically
  const keys = Object.keys(faceSet);
  const known = keys.filter((key) => !faceSet[key].autoAdded);
  const autoAdded = keys.filter((key) => faceSet[key].autoAdded)
    .sort((a, b) => (faceSet[a].addedAt || 0) - (faceSet[b].addedAt || 0));
  [...known, ...autoAdded].forEach((key) => {
    const option = document.createElement('option');
    option.text = faceSet[key].label;
    option.value = faceSet[key].face_token;
    dropDown.add(option);
  });
  faceSelected();
}

// detect face info
async function detectFace(img) {
  try {
    const faces = await new Promise((resolve, reject) => {
      Homey.api('POST', 'detectface/', { img }, (err, result) => {
        clearInfo();
        if (err) return reject(err);
        if (!result.face_num) return reject(Error(Homey.__('settings.tab4.noFaceDetected')));
        if (result.face_num > 1) return reject(Error(Homey.__('settings.tab4.multipleFacesDetected')));
        return resolve(result);
      });
    });
    faceInfo = faces.faces[0] || {};
    showInfo(faceInfo, true);
    return faces;
  } catch (error) {
    Homey.alert(errMsg(error), 'error');
    return undefined;
  }
}

// Face++'s documented file size limit for the detect API (image_file/image_base64)
// is 2MB, measured on the raw (non-base64) file - see zzz_apidocs/detect.txt
const FACEPP_MAX_FILE_BYTES = 2 * 1024 * 1024;

// load image file
function loadFile(event) {
  const imgFile = event.target.files[0];
  const preview = document.getElementById('preview');
  clearInfo();
  // check the real file size up front - avoids reading+base64-encoding a file we're
  // going to reject anyway, and avoids the old check rejecting images well under 2MB
  // (it compared the ~33% larger base64 STRING length against a 1MB cutoff)
  if (imgFile.size > FACEPP_MAX_FILE_BYTES) {
    Homey.alert(Homey.__('settings.tab4.imageTooLarge'), 'error');
    return;
  }
  const reader = new FileReader();
  reader.readAsDataURL(imgFile); // converts the blob to base64 and calls onload
  reader.onload = () => {
    const imgBase64 = reader.result; // data url
    preview.src = imgBase64; // show in frontend
    document.getElementById('faceToken').value = Homey.__('settings.tab4.analyzing');
    detectFace(imgBase64);
  };
}

function addFace() {
  const img = document.getElementById('preview').src;
  Homey.api('POST', 'addface/', { img, faceInfo }, (err) => {
    if (err) {
      Homey.alert(errMsg(err), 'error');
      return;
    }
    fillDropdown();
    Homey.alert(Homey.__('settings.tab4.faceSaved'), 'info');
  });
}

async function updateFace() {
  try {
    const fset = await getFaceSet();
    // a manual edit here means the user has now confirmed/named this face - it no
    // longer counts against the auto-add max count in app.js's autoAddFace()
    delete faceInfo.autoAdded;
    fset[faceInfo.face_token] = faceInfo;
    await Homey.set('face_set', fset);
    Homey.alert(Homey.__('settings.tab4.faceUpdated'), 'info');
  } catch (error) {
    Homey.alert(errMsg(error), 'error');
  }
}

function saveFace() {
  faceInfo.label = document.getElementById('label').value;
  faceInfo.face_token = document.getElementById('faceToken').value;
  if (!faceInfo.face_token || faceInfo.face_token.length !== 32) {
    Homey.alert(Homey.__('settings.tab4.invalidToken'), 'error');
    return;
  }
  // check if new face, or only updated label
  if (Object.prototype.hasOwnProperty.call(faceSet, faceInfo.face_token)) {
    updateFace();
    return;
  }
  addFace();
}

function deleteFace() {
  const selectedFace = document.getElementById('faceList').value;
  if (selectedFace === 'null' || selectedFace === 'undefined' || !selectedFace) return;
  // deleting a face is only ever reachable from here (this button, behind this
  // confirmation) - never automatically, and never from a flow
  Homey.confirm(Homey.__('settings.tab4.deleteFaceWarning'), 'warning', (error, result) => {
    if (error || !result) return;
    Homey.api('POST', 'deleteface/', { faceInfo: { face_token: selectedFace } }, (err) => {
      if (err) {
        Homey.alert(errMsg(err), 'error');
        return;
      }
      fillDropdown();
      Homey.alert(Homey.__('settings.tab4.faceDeleted'), 'info');
    });
  });
}

function showAutoAddSettings() {
  Homey.get('settingsAutoAdd', (err, set) => {
    if (err || !set) return;
    document.getElementById('autoAddEnabled').checked = !!set.enabled;
    if (set.threshold !== undefined) document.getElementById('autoAddThreshold').value = set.threshold;
    if (set.maxCount !== undefined) document.getElementById('autoAddMaxCount').value = set.maxCount;
  });
}

async function saveSettingsAutoAdd() {
  try {
    const enabled = document.getElementById('autoAddEnabled').checked;
    const threshold = document.getElementById('autoAddThreshold').value;
    const maxCount = document.getElementById('autoAddMaxCount').value;
    if (threshold < 1 || threshold > 100) throw Error(Homey.__('settings.tab3.thresholdInvalid'));
    await Homey.set('settingsAutoAdd', { enabled, threshold, maxCount });
    Homey.alert(Homey.__('settings.tab3.matchSaved'), 'info');
  } catch (error) {
    Homey.alert(errMsg(error), 'error');
  }
}

// "Import faces" (other-Homeys rows) and "Import faces from cloud" (own row, sourceOuterId
// equal to this Homey's own outerId) - one-time, explicit import of known faces (label,
// gender/age/glasses if available, no photo) from one specific Homey's set into this one.
// Never runs automatically. Existing local faces, and any locally stored photos, are never
// touched - only faces not already known locally are ever imported.
//
// The backend runs the import in the background rather than responding only once it's
// done - importing many candidates takes several rate-limited Face++ calls each and can
// run well past a minute, long enough to trip Homey.api()'s own client-side timeout if
// this page waited for the full result. So there's no live progress here; the actual
// outcome (imported/merged/skipped counts) is written to the Log tab once it finishes.
function importFacesFrom(sourceOuterId, isSelf) {
  const warningKey = isSelf ? 'settings.tab5.importFromCloudWarning' : 'settings.tab5.importFacesWarning';
  Homey.confirm(Homey.__(warningKey), 'warning', (error, result) => {
    if (error || !result) return;
    Homey.api('POST', 'facesets/import/', { sourceOuterId }, (err) => {
      if (err) {
        Homey.alert(errMsg(err), 'error');
        return;
      }
      Homey.alert(Homey.__('settings.tab5.fetchFacesStarted'), 'info');
    });
  });
}

// "Rebuild" button, own-Homey row only. Rebuilds THIS Homey's Face++ faceset from
// the local Manage Faces list (local -> cloud) - unlike "Delete" (reserved for other
// Homeys), this can't leave face recognition broken, since it immediately re-adds
// everything from the local list right after clearing the cloud side. Not useful right
// after a reinstall (local list is empty then) - see "Import faces"
// (importFacesFrom(), called with this Homey's own outerId) for that case.
function resyncOwnFaceset() {
  Homey.confirm(Homey.__('settings.tab5.rebuildWarning'), 'warning', (error, result) => {
    if (error || !result) return;
    Homey.api('POST', 'facesets/resync/', null, (err) => {
      if (err) {
        Homey.alert(errMsg(err), 'error');
        return;
      }
      Homey.alert(Homey.__('settings.tab5.rebuildStarted'), 'info');
    });
  });
}

// shows the actual confirm dialog once we know how many faces are in it, then deletes
function confirmDeleteForeignFaceset(outerId, faceCount) {
  const countText = typeof faceCount === 'number'
    ? ` (${faceCount} ${Homey.__('settings.tab5.faceCountUnit')})`
    : '';
  const warning = [
    `${Homey.__('settings.tab5.deleteFacesetWarningPrefix')} "${outerId}"${countText}.`,
    Homey.__('settings.tab5.deleteFacesetWarningSuffix'),
  ].join(' ');
  Homey.confirm(warning, 'warning', (error, result) => {
    if (error || !result) return;
    Homey.api('POST', 'facesets/delete/', { outerId }, (err) => {
      if (err) {
        Homey.alert(errMsg(err), 'error');
        return;
      }
      Homey.alert(Homey.__('settings.tab5.facesetDeleted'), 'info');
      loadForeignFacesets();
    });
  });
}

// permanently deletes another Homey's faceset - only ever reachable from the button in
// loadForeignFacesets() below. Fetches the face count on-demand (a single call, not part
// of the bulk list) so the confirmation can name it, then confirms, then deletes.
function deleteForeignFaceset(outerId) {
  Homey.api('POST', 'facesets/count/', { outerId }, (err, res) => {
    const faceCount = (!err && res && typeof res.faceCount === 'number') ? res.faceCount : undefined;
    confirmDeleteForeignFaceset(outerId, faceCount);
  });
}

// builds one row (own or foreign) and appends it to the given container, in the exact
// same layout either way: id/count on the left, buttons on the right. "Import faces"
// is the same button, same label, same first position for both - it pulls known faces
// (name only) into this Homey's local list, from another Homey's cloud set on foreign
// rows, or from this Homey's own cloud set on its own row (e.g. after reinstalling the
// app; existing local faces and their locally stored photos are never touched). The
// second button differs: "Rebuild" (own row only, styled as danger) pushes the local
// list back out to the cloud, deleting whatever's there and replacing it; "Delete"
// (foreign rows only) permanently removes that Homey's cloud set.
//
// Face counts are lazy-loaded: the row renders immediately with a placeholder, then its
// count is fetched independently right after, so one slow or failed count can't hold up
// the rest of the list. An earlier version fetched every count up front as part of the
// list call, and that fan-out was slow enough - especially under real Face++-side
// throttling - to trip Homey.api()'s own client-side timeout.
function renderFacesetRow(container, entry) {
  const row = document.createElement('div');
  row.className = 'homey-form-group';
  row.style.display = 'flex';
  row.style.alignItems = 'center';
  row.style.gap = '8px';

  const text = document.createElement('span');
  text.style.flex = '1';
  text.textContent = `${entry.outerId} — …`; // count fills in once loaded
  row.appendChild(text);

  const importButton = document.createElement('button');
  importButton.className = 'homey-button-secondary';
  importButton.textContent = Homey.__('settings.tab5.importFacesButton');
  importButton.onclick = () => importFacesFrom(entry.outerId, entry.isOwn);
  row.appendChild(importButton);

  if (entry.isOwn) {
    const rebuildButton = document.createElement('button');
    rebuildButton.className = 'homey-button-danger';
    rebuildButton.textContent = Homey.__('settings.tab5.rebuildButton');
    rebuildButton.onclick = () => resyncOwnFaceset();
    row.appendChild(rebuildButton);
  } else {
    const deleteButton = document.createElement('button');
    deleteButton.className = 'homey-button-danger';
    deleteButton.textContent = Homey.__('settings.tab5.deleteFacesetButton');
    deleteButton.onclick = () => deleteForeignFaceset(entry.outerId);
    row.appendChild(deleteButton);
  }

  container.appendChild(row);

  // lazy-load this row's face count on its own, independent of every other row
  Homey.api('POST', 'facesets/count/', { outerId: entry.outerId }, (countErr, countRes) => {
    const faceCount = (!countErr && countRes && typeof countRes.faceCount === 'number') ? countRes.faceCount : 0;
    text.textContent = `${entry.outerId} — ${faceCount} ${Homey.__('settings.tab5.faceCountUnit')}`;
  });
}

// list every Homey on this account, split across two panels: this Homey's own row
// (Import faces / Rebuild) in one fieldset, every other Homey
// (Import faces / Delete) in another.
function loadForeignFacesets() {
  const thisHomeyContainer = document.getElementById('thisHomeyRow');
  const otherContainer = document.getElementById('foreignFacesetsList');
  thisHomeyContainer.textContent = '';
  otherContainer.textContent = '';
  Homey.api('GET', 'facesets/', null, (err, list) => {
    if (err) {
      otherContainer.textContent = errMsg(err);
      return;
    }
    if (!Array.isArray(list) || !list.length) {
      const empty = document.createElement('p');
      empty.textContent = Homey.__('settings.tab5.facesetsEmpty');
      otherContainer.appendChild(empty);
      return;
    }
    const otherEntries = list.filter((entry) => !entry.isOwn);
    list.filter((entry) => entry.isOwn).forEach((entry) => renderFacesetRow(thisHomeyContainer, entry));
    if (!otherEntries.length) {
      const empty = document.createElement('p');
      empty.textContent = Homey.__('settings.tab5.facesetsEmpty');
      otherContainer.appendChild(empty);
      return;
    }
    otherEntries.forEach((entry) => renderFacesetRow(otherContainer, entry));
  });
}

// generic stuff here
function showTab(tab) {
  if (tab === 2) updateLogs();
  if (tab === 3) {
    checkKeys();
    showInfo3();
  }
  if (tab === 4) {
    checkKeys();
    fillDropdown();
    showAutoAddSettings();
  }
  if (tab === 5) {
    checkKeys();
    loadForeignFacesets();
  }
  [1, 2, 3, 4, 5].forEach((t) => {
    document.getElementById(`tab${t}`).style.display = t === tab ? '' : 'none';
    document.getElementById(`tabb${t}`).className = t === tab ? 'homey-button-primary' : 'homey-button-secondary';
  });
}

function onHomeyReady(homeyReady) {
  Homey = homeyReady;
  showInfo3();
  showTab(1);
  Homey.ready();
}
