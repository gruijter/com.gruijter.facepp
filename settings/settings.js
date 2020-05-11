/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */

// tab 2 stuff here
function displayLogs(lines) {
	$('#loglines').html(lines);
}

function updateLogs() {
	try {
		displayLogs('');
		const showLogs = $('#show_logs').prop('checked');
		const showErrors = $('#show_errors').prop('checked');
		const showNoDetects = $('#show_no_detections').prop('checked');
		Homey.api('GET', 'getlogs/', null, (err, result) => {
			if (!err) {
				let lines = '';
				result
					.reverse()
					.forEach((line) => {
						if (!showLogs) {
							if (line.includes('[log]')) return;
						}
						if (!showErrors) {
							if (line.includes('[err]')) return;
						}
						if (!showNoDetects) {
							if (line.includes(' found in image')) return;
						}
						const logLine = line.replace(' [FaceApp]', '');
						lines += `${logLine}<br />`;

					});
				displayLogs(lines);
			} else {
				displayLogs(err);
			}
		});
	} catch (e) {
		displayLogs(e);
	}
}

function deleteLogs() {
	Homey.confirm(Homey.__('settings.tab2.deleteWarning'), 'warning', (error, result) => {
		if (result) {
			Homey.api('GET', 'deletelogs/', null, (err) => {
				if (err) {
					Homey.alert(err.message, 'error'); // [, String icon], Function callback )
				} else {
					Homey.alert(Homey.__('settings.tab2.deleted'), 'info');
					updateLogs();
				}
			});
		}
	});
}

// tab 3 stuff here
function checkKeys() {
	Homey.get('settingsKey', (error, set) => {
		if (error || !set) return Homey.alert('API Key and Secret are not saved!', 'error');
		if (!set.apiKey || set.apiKey.length < 10
			|| !set.apiSecret || set.apiSecret.length < 10) return Homey.alert('API Key and Secret are not correctly saved!', 'error');
		return true;
	});
}

function showInfo3() {
	const x = document.getElementById('apiSecret');
	x.type = 'password';
	Homey.get('settingsKey', (err, set) => {
		if (err || !set) return;
		$('#apiKey').val(set.apiKey);
		$('#apiSecret').val(set.apiSecret);
	});
	Homey.get('settingsMatch', (err, set) => {
		if (err || !set) return;
		$('#threshold').val(set.threshold);
	});
}

function togglePasswordView() {
	const x = document.getElementById('apiSecret');
	if (x.type === 'password') {
		x.type = 'text';
	} else {
		x.type = 'password';
	}
}

async function saveSettingsKey() {
	try {
		const apiKey = $('#apiKey').val();
		const apiSecret = $('#apiSecret').val();
		await Homey.set('settingsKey', { apiKey, apiSecret });
		return Homey.alert('API Keys are saved!', 'info');
	} catch (error) {
		return Homey.alert(error.message, 'error');
	}
}

async function saveSettingsMatch() {
	try {
		const threshold = $('#threshold').val();
		if (threshold < 0 || threshold > 100) throw Error('Threshold must be between 0 and 100');
		await Homey.set('settingsMatch', { threshold });
		return Homey.alert('Settings are saved!', 'info');
	} catch (error) {
		return Homey.alert(error.message, 'error');
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
	// $('#label').val('');
	$('#faceToken').val('');
	$('#facequality').val(0);
	$('#gender').val('');
	$('#age').val(0);
	$('#glass').val('');
}

function showInfo(face, detected) {
	// add new face; disable save, enable photo upload, clear label
	if (!face || !face.face_token) {
		$('#label').val('');
		$('#file').show();
		$('#preview').prop('src', '../assets/icon.svg');
		$('#saveFace').attr('disabled', true);
		$('#deleteFace').attr('disabled', true);
		clearInfo();
		return;
	}
	// newly detected, unsaved face; enable save, enable upload photo
	if (detected) {
		$('#file').show();
		$('#saveFace').attr('disabled', false);
		$('#deleteFace').attr('disabled', true);
	}
	// existing face: load image, load label, disable upload photo
	if (!detected) {
		$('#file').hide();
		$('#saveFace').attr('disabled', false);
		$('#deleteFace').attr('disabled', false);
		$('#label').val(face.label);
		const imgPath = `../userdata/${face.face_token}.img`;
		$('#preview').prop('src', imgPath);
	}
	$('#faceToken').val(face.face_token);
	$('#facequality').val(face.attributes.facequality.value);
	$('#gender').val(face.attributes.gender.value);
	$('#age').val(face.attributes.age.value);
	$('#glass').val(face.attributes.glass.value);
}

function faceSelected() {
	const selectedFace = $('#faceList').val();
	// if (selectedFace === ('null' || 'undefined')) clearInfo();
	faceInfo = faceSet[selectedFace] || {};
	showInfo(faceInfo);
}

// function to populate the dropdown list
async function fillDropdown() {
	// first empty the dropdownlist
	const dropDown = document.getElementById('faceList'); // $('#faceList');
	while (dropDown.length > 0) {
		dropDown.remove(dropDown.length - 1);
	}
	// now fill the dropdown list and add an empty item in the dropdown list
	const newOption = document.createElement('option');
	newOption.text = __('settings.tab4.newFace');
	newOption.value = null;
	dropDown.add(newOption);
	faceSet = await getFaceSet();
	Object.keys(faceSet).forEach((key) => {
		const option = document.createElement('option');
		option.text = `${faceSet[key].label}-${faceSet[key].face_token}`;
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
				if (!result.face_num) return reject(Error('No face detected'));
				if (result.face_num > 1) return reject(Error(`${result.face_num} faces detected, but only one allowed`));
				return resolve(result);
			});
		});
		faceInfo = faces.faces[0] || {};
		showInfo(faceInfo, true);
		return faces;
	} catch (error) {
		return Homey.alert(error.message, 'error');
	}
}

// load image file
function loadFile(event) {
	const imgFile = event.target.files[0];
	const preview = document.getElementById('preview');
	// make base64 file and display
	const reader = new FileReader();
	reader.readAsDataURL(imgFile); // converts the blob to base64 and calls onload
	reader.onload = () => {
		const imgBase64 = reader.result; // data url
		preview.src = imgBase64; // show in frontend
		clearInfo();
		if (imgBase64.length > 1048000) return Homey.alert('Image size is too large', 'error');
		$('#faceToken').val('Analyzing. Hang on....');
		// Homey.alert('Face is being analyzed. Hang on...', 'info');
		return detectFace(imgBase64);
	};
}

function addFace() {
	// const img = $('#preview').attr('src');
	const img = document.getElementById('preview').src;
	return Homey.api('POST', 'addface/', { img, faceInfo }, (err, result) => {
		if (err) {
			Homey.alert(err.message, 'error'); // [, String icon], Function callback )
			return;
		}
		fillDropdown();
		Homey.alert('Face is saved!', 'info');
	});
}

async function updateFace() {
	try {
		const fset = await getFaceSet();
		fset[faceInfo.face_token] = faceInfo;
		await Homey.set('face_set', fset);
		Homey.alert('Face label is updated!', 'info');
	} catch (error) {
		Homey.alert(error.message, 'error');
	}
}

function saveFace() {
	faceInfo.label = $('#label').val();
	faceInfo.face_token = $('#faceToken').val();
	if (!faceInfo.face_token || faceInfo.face_token.length !== 32) return Homey.alert('Invalid face token. Upload a valid face image.', 'error');
	// check if new face, or only updated label
	if (Object.prototype.hasOwnProperty.call(faceSet, faceInfo.face_token)) {
		return updateFace();
	}
	return addFace();
}

function deleteFace() {
	const selectedFace = $('#faceList').val();
	if (selectedFace === ('null' || 'undefined')) return;
	Homey.api('POST', 'deleteface/', { faceInfo: { face_token: selectedFace } }, (err, result) => {
		if (err) {
			Homey.alert(err.message, 'error'); // [, String icon], Function callback )
			return;
		}
		fillDropdown();
		Homey.alert('Face is deleted!', 'info');
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
	}
	$('.tab').removeClass('tab-active');
	$('.tab').addClass('tab-inactive');
	$(`#tabb${tab}`).removeClass('tab-inactive');
	$(`#tabb${tab}`).addClass('active');
	$('.panel').hide();
	$(`#tab${tab}`).show();
}

function onHomeyReady(homeyReady) {
	Homey = homeyReady;
	showInfo3();
	showTab(1);
	Homey.ready();
}
