/**
 * =======================================================================================
 * FACE RECOGNITION ATTENDANCE MODULE - REAL-TIME CLIENT-SIDE AI ENGINE & PORTAL INTEGRATION
 * Database Sheet: https://docs.google.com/spreadsheets/d/1Up9Z42R39lRxHzHy9ojLtrQy0CV9skA6EWl6rgIzKRA/edit?gid=0#gid=0
 * Spreadsheet ID: 1Up9Z42R39lRxHzHy9ojLtrQy0CV9skA6EWl6rgIzKRA
 * =======================================================================================
 */

(function () {
    'use strict';

    // --- Configuration & Constants ---
    const SPREADSHEET_ID = "1Up9Z42R39lRxHzHy9ojLtrQy0CV9skA6EWl6rgIzKRA";
    const SPREADSHEET_URL = "https://docs.google.com/spreadsheets/d/1Up9Z42R39lRxHzHy9ojLtrQy0CV9skA6EWl6rgIzKRA/edit?gid=0#gid=0";
    const DEFAULT_API_URL = "https://script.google.com/macros/s/AKfycbzIUuoIiPZvACnRoZr1ATaiBEtdHknPZG3lK3ENe7OwHI4BOpjoVUAewpaC4wIShvudWQ/exec";
    const STORAGE_KEY_API_URL = "ds_face_api_url";
    const STORAGE_KEY_REGISTERED = "ds_face_registered_students";
    const STORAGE_KEY_LOGS = "ds_face_attendance_logs";
    const STORAGE_KEY_SCHEDULES = "ds_face_schedule_settings";
    const STORAGE_KEY_HOLIDAYS = "ds_face_holidays";

    // Default Schedules
    const DEFAULT_SCHEDULES = {
        schedule_mode: "hourly", // "session" (FN/AN) or "hourly"
        fn_start_time: "08:30",
        fn_end_time: "12:30",
        fn_grace_minutes: "15",
        an_start_time: "13:30",
        an_end_time: "17:30",
        an_grace_minutes: "15",
        hourly_grace_minutes: "10",
        hourly_slots: [
            { hour: 1, name: "1st Hour", start: "08:45", end: "09:35", label: "8:45 - 9:35 AM", grace_minutes: 10 },
            { hour: 2, name: "2nd Hour", start: "09:35", end: "10:25", label: "9:35 - 10:25 AM", grace_minutes: 10 },
            { hour: 3, name: "3rd Hour", start: "10:40", end: "11:30", label: "10:40 - 11:30 AM", grace_minutes: 10 },
            { hour: 4, name: "4th Hour", start: "11:30", end: "12:25", label: "11:30 AM - 12:25 PM", grace_minutes: 10 },
            { hour: 5, name: "5th Hour", start: "13:30", end: "14:20", label: "1:30 - 2:20 PM", grace_minutes: 10 },
            { hour: 6, name: "6th Hour", start: "14:20", end: "15:10", label: "2:20 - 3:10 PM", grace_minutes: 10 },
            { hour: 7, name: "7th Hour", start: "15:25", end: "16:25", label: "3:25 - 4:25 PM", grace_minutes: 10 }
        ]
    };

    // Module State
    window.FaceRecognitionState = {
        modelsLoaded: false,
        modelsLoading: false,
        registeredStudents: [],
        attendanceLogs: [],
        schedules: { ...DEFAULT_SCHEDULES },
        holidays: [],
        activeStream: null,
        activeCameraId: null,
        isKioskScanning: false,
        kioskAnimationId: null,
        matcher: null,
        activeTab: "kiosk", // "kiosk", "register", "schedules", "analytics", "settings"
        apiUrl: localStorage.getItem(STORAGE_KEY_API_URL) || DEFAULT_API_URL,
        lastRecognizedReg: null,
        lastRecognizedTime: 0,
        scanCooldownMs: 3500, // 3.5s cooldown between consecutive auto-affixes for same student
        matchThreshold: 0.55 // Euclidean distance threshold (lower is stricter, 0.55 is standard)
    };

    // --- Audio Feedback Synthesizer (Web Audio API) ---
    function playBeep(type = 'success') {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;
            const ctx = new AudioContext();

            if (type === 'success') {
                // Pleasant ascending 2-tone chime
                const osc1 = ctx.createOscillator();
                const osc2 = ctx.createOscillator();
                const gain = ctx.createGain();

                osc1.type = 'sine';
                osc2.type = 'triangle';
                osc1.frequency.setValueAtTime(659.25, ctx.currentTime); // E5
                osc1.frequency.setValueAtTime(880.00, ctx.currentTime + 0.1); // A5

                gain.gain.setValueAtTime(0.2, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

                osc1.connect(gain);
                gain.connect(ctx.destination);
                osc1.start();
                osc1.stop(ctx.currentTime + 0.35);
            } else if (type === 'warning') {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(440, ctx.currentTime);
                osc.frequency.setValueAtTime(370, ctx.currentTime + 0.15);
                gain.gain.setValueAtTime(0.15, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start();
                osc.stop(ctx.currentTime + 0.3);
            }
        } catch (e) {
            console.warn("Audio feedback error:", e);
        }
    }

    // --- AI Model Loader ---
    async function loadFaceModels() {
        if (window.FaceRecognitionState.modelsLoaded) return true;
        if (window.FaceRecognitionState.modelsLoading) return false;

        window.FaceRecognitionState.modelsLoading = true;
        const statusBadges = [
            document.getElementById('face-model-status-badge'),
            document.getElementById('face-model-status-badge-mobile')
        ];
        statusBadges.forEach(el => {
            if (el) el.innerHTML = `<span style="color: #F59E0B; display: inline-flex; align-items: center; gap: 4px;"><div class="spinner-border spinner-border-sm" style="width: 10px; height: 10px; border-width: 2px;"></div> Loading Neural AI...</span>`;
        });

        try {
            // Check if faceapi library is available
            const faceapiLib = window.faceapi || (typeof faceapi !== 'undefined' ? faceapi : null);
            if (!faceapiLib) {
                console.warn("face-api library not loaded from CDN yet, checking CDN fallback...");
                await loadScriptAsync("https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/dist/face-api.js");
            }

            const activeLib = window.faceapi || (typeof faceapi !== 'undefined' ? faceapi : null);
            if (activeLib) {
                // Try primary model CDN, fallback to secondary
                const modelUrls = [
                    "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/",
                    "https://cdn.jsdelivr.net/gh/cshlye/face-api.js-models@master/",
                    "https://justadudewhohacks.github.io/face-api.js/models/"
                ];

                let loaded = false;
                for (const url of modelUrls) {
                    try {
                        console.log(`Attempting to load face-api models from: ${url}`);
                        await Promise.all([
                            activeLib.nets.tinyFaceDetector.loadFromUri(url),
                            activeLib.nets.faceLandmark68Net.loadFromUri(url),
                            activeLib.nets.faceRecognitionNet.loadFromUri(url)
                        ]);
                        loaded = true;
                        console.log("Successfully loaded face-api neural models from:", url);
                        break;
                    } catch (netErr) {
                        console.warn(`Failed loading from ${url}, trying next CDN...`, netErr);
                    }
                }

                if (loaded) {
                    window.FaceRecognitionState.modelsLoaded = true;
                    statusBadges.forEach(el => {
                        if (el) el.innerHTML = `<span style="color: #10B981; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">● AI Models Ready</span>`;
                    });
                    rebuildFaceMatcher();
                    return true;
                }
            }
        } catch (e) {
            console.error("Error loading face models:", e);
        } finally {
            window.FaceRecognitionState.modelsLoading = false;
        }

        statusBadges.forEach(el => {
            if (el) el.innerHTML = `<span style="color: #6366F1; font-weight: 700;">⚡ Ready</span>`;
        });
        return false;
    }

    function loadScriptAsync(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.onload = () => resolve(true);
            s.onerror = (e) => resolve(false);
            document.head.appendChild(s);
        });
    }

    // --- Face Matcher Rebuilding ---
    function rebuildFaceMatcher() {
        const faceapiLib = window.faceapi || (typeof faceapi !== 'undefined' ? faceapi : null);
        const registered = window.FaceRecognitionState.registeredStudents || [];

        if (!faceapiLib || !window.FaceRecognitionState.modelsLoaded || registered.length === 0) {
            window.FaceRecognitionState.matcher = null;
            return;
        }

        try {
            const labeledDescriptors = [];
            registered.forEach(student => {
                if (!student.descriptor) return;
                try {
                    let descArray = null;
                    if (typeof student.descriptor === 'string') {
                        descArray = JSON.parse(student.descriptor);
                    } else if (Array.isArray(student.descriptor)) {
                        descArray = student.descriptor;
                    }
                    if (descArray && descArray.length) {
                        const float32 = new Float32Array(descArray);
                        const label = `${student.reg_num}|||${student.name}|||${student.department || ''}`;
                        labeledDescriptors.push(new faceapiLib.LabeledFaceDescriptors(label, [float32]));
                    }
                } catch (parseErr) {
                    console.warn(`Failed to parse descriptor for ${student.reg_num}:`, parseErr);
                }
            });

            if (labeledDescriptors.length > 0) {
                window.FaceRecognitionState.matcher = new faceapiLib.FaceMatcher(
                    labeledDescriptors,
                    window.FaceRecognitionState.matchThreshold
                );
                console.log(`Rebuilt FaceMatcher with ${labeledDescriptors.length} registered students.`);
            } else {
                window.FaceRecognitionState.matcher = null;
            }
        } catch (e) {
            console.error("Error rebuilding face matcher:", e);
        }
    }

    // --- Local Storage & Cloud Sync ---
    function loadLocalState() {
        try {
            const savedRegistered = localStorage.getItem(STORAGE_KEY_REGISTERED);
            if (savedRegistered) window.FaceRecognitionState.registeredStudents = JSON.parse(savedRegistered);

            const savedLogs = localStorage.getItem(STORAGE_KEY_LOGS);
            if (savedLogs) window.FaceRecognitionState.attendanceLogs = JSON.parse(savedLogs);

            const savedSchedules = localStorage.getItem(STORAGE_KEY_SCHEDULES);
            if (savedSchedules) {
                const parsed = JSON.parse(savedSchedules);
                if (!parsed.hourly_slots || !Array.isArray(parsed.hourly_slots) || parsed.hourly_slots.length !== 7) {
                    parsed.hourly_slots = DEFAULT_SCHEDULES.hourly_slots;
                }
                window.FaceRecognitionState.schedules = { ...DEFAULT_SCHEDULES, ...parsed };
            }

            const savedHolidays = localStorage.getItem(STORAGE_KEY_HOLIDAYS);
            if (savedHolidays) window.FaceRecognitionState.holidays = JSON.parse(savedHolidays);

            // Pre-seed Indresh S if database is completely empty
            if (window.FaceRecognitionState.registeredStudents.length === 0 && window.STUDENT_DATABASE && window.STUDENT_DATABASE.length > 0) {
                const s0 = window.STUDENT_DATABASE[0];
                window.FaceRecognitionState.registeredStudents.push({
                    reg_num: s0.reg_num,
                    name: s0.name,
                    department: s0.department,
                    year: s0.year,
                    email: s0.mailid,
                    photo_thumbnail: "profile.png",
                    registered_at: new Date().toISOString(),
                    registered_by: "System Admin",
                    status: "Active"
                });
                saveLocalState();
            }
        } catch (e) {
            console.error("Error reading local face recognition state:", e);
        }
    }

    function saveLocalState() {
        try {
            localStorage.setItem(STORAGE_KEY_REGISTERED, JSON.stringify(window.FaceRecognitionState.registeredStudents));
            localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(window.FaceRecognitionState.attendanceLogs));
            localStorage.setItem(STORAGE_KEY_SCHEDULES, JSON.stringify(window.FaceRecognitionState.schedules));
            localStorage.setItem(STORAGE_KEY_HOLIDAYS, JSON.stringify(window.FaceRecognitionState.holidays));
        } catch (e) {
            console.error("Error saving local face recognition state:", e);
        }
    }

    // --- Google Apps Script Cloud Sync ---
    async function syncWithCloud(silent = false) {
        const apiUrl = window.FaceRecognitionState.apiUrl;
        if (!apiUrl) {
            if (!silent) alert("Google Apps Script Web App URL is not configured yet. Using local database cache.");
            return;
        }

        try {
            const res = await fetch(`${apiUrl}?action=get_all_data`);
            const data = await res.json();
            if (data.status === 'success') {
                if (data.registeredFaces && Array.isArray(data.registeredFaces) && data.registeredFaces.length > 0) {
                    window.FaceRecognitionState.registeredStudents = data.registeredFaces;
                }
                if (data.attendanceLogs && Array.isArray(data.attendanceLogs)) {
                    window.FaceRecognitionState.attendanceLogs = data.attendanceLogs;
                }
                if (data.schedules && Object.keys(data.schedules).length > 0) {
                    window.FaceRecognitionState.schedules = { ...DEFAULT_SCHEDULES, ...data.schedules };
                }
                if (data.holidays && Array.isArray(data.holidays)) {
                    window.FaceRecognitionState.holidays = data.holidays;
                }

                saveLocalState();
                rebuildFaceMatcher();
                renderAllFaceViews();
                console.log("Successfully synced face data with Google Sheet database.");
            }
        } catch (err) {
            console.warn("Cloud sync failed (offline or invalid Apps Script URL):", err);
        }
    }

    // --- Schedule & Holiday Checking Logic ---
    function getActiveScheduleStatus() {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const todayStr = `${yyyy}-${mm}-${dd}`;

        // 1. Holiday Check
        const holidays = window.FaceRecognitionState.holidays || [];
        const holidayMatch = holidays.find(h => h.holiday_date === todayStr);
        if (holidayMatch) {
            return {
                isHoliday: true,
                holidayTitle: holidayMatch.title || "Holiday",
                holidayType: holidayMatch.type || "Full Day",
                isOpen: false,
                currentSlotName: `Holiday: ${holidayMatch.title}`,
                statusBadge: `<span style="background: #FEF2F2; color: #DC2626; padding: 4px 12px; border-radius: 99px; font-weight: 800; font-size: 0.8rem;">🏖️ ${holidayMatch.title} (Exempted)</span>`
            };
        }

        const schedules = window.FaceRecognitionState.schedules || DEFAULT_SCHEDULES;
        const currentHours = now.getHours();
        const currentMins = now.getMinutes();
        const currentTimeMinutes = currentHours * 60 + currentMins;

        const timeToMinutes = (str) => parseTimeToMinutes(str);

        // 2. Session Mode (FN / AN)
        if (schedules.schedule_mode === 'session') {
            const fnStart = timeToMinutes(schedules.fn_start_time || "08:30");
            const fnEnd = timeToMinutes(schedules.fn_end_time || "12:30");
            const fnGrace = parseInt(schedules.fn_grace_minutes || "15", 10);

            const anStart = timeToMinutes(schedules.an_start_time || "13:30");
            const anEnd = timeToMinutes(schedules.an_end_time || "17:30");
            const anGrace = parseInt(schedules.an_grace_minutes || "15", 10);

            if (currentTimeMinutes >= fnStart && currentTimeMinutes <= fnEnd) {
                const isLate = currentTimeMinutes > (fnStart + fnGrace);
                return {
                    isHoliday: false,
                    isOpen: true,
                    sessionType: "FN",
                    slotName: "Forenoon Session (FN)",
                    isLate: isLate,
                    statusText: isLate ? "Late" : "On Time",
                    windowDesc: `${schedules.fn_start_time} - ${schedules.fn_end_time}`,
                    statusBadge: `<span style="background: #ECFDF5; color: #059669; padding: 4px 12px; border-radius: 99px; font-weight: 800; font-size: 0.8rem;">🟢 FN Slot Active (${schedules.fn_start_time} - ${schedules.fn_end_time})</span>`
                };
            } else if (currentTimeMinutes >= anStart && currentTimeMinutes <= anEnd) {
                const isLate = currentTimeMinutes > (anStart + anGrace);
                return {
                    isHoliday: false,
                    isOpen: true,
                    sessionType: "AN",
                    slotName: "Afternoon Session (AN)",
                    isLate: isLate,
                    statusText: isLate ? "Late" : "On Time",
                    windowDesc: `${schedules.an_start_time} - ${schedules.an_end_time}`,
                    statusBadge: `<span style="background: #EFF6FF; color: #2563EB; padding: 4px 12px; border-radius: 99px; font-weight: 800; font-size: 0.8rem;">🔵 AN Slot Active (${schedules.an_start_time} - ${schedules.an_end_time})</span>`
                };
            } else {
                return {
                    isHoliday: false,
                    isOpen: false,
                    sessionType: currentTimeMinutes < fnStart ? "FN (Early)" : "Outside Window",
                    slotName: "Outside Scheduled Window",
                    windowDesc: `FN: ${schedules.fn_start_time}-${schedules.fn_end_time} | AN: ${schedules.an_start_time}-${schedules.an_end_time}`,
                    statusBadge: `<span style="background: #F1F5F9; color: #64748B; padding: 4px 12px; border-radius: 99px; font-weight: 800; font-size: 0.8rem;">⏳ Outside Slot Window</span>`
                };
            }
        }

        // 3. Hourly Mode (7 Periods with strict 10-Minute Grace Window)
        const hourlySlots = (schedules.hourly_slots && schedules.hourly_slots.length === 7)
            ? schedules.hourly_slots
            : DEFAULT_SCHEDULES.hourly_slots;

        for (const slot of hourlySlots) {
            const startMins = timeToMinutes(slot.start);
            const endMins = timeToMinutes(slot.end);
            const graceMins = parseInt(slot.grace_minutes || schedules.hourly_grace_minutes || "10", 10);
            const graceCutoffMins = startMins + graceMins;

            if (currentTimeMinutes >= startMins && currentTimeMinutes <= endMins) {
                const isWithin10 = currentTimeMinutes <= graceCutoffMins;
                const statusText = isWithin10 ? "Present" : "Absent";
                const isLate = !isWithin10;

                return {
                    isHoliday: false,
                    isOpen: true,
                    sessionType: `Hour_${slot.hour}`,
                    slotName: slot.name || `Hour ${slot.hour}`,
                    isLate: isLate,
                    statusText: statusText,
                    windowDesc: `${slot.label || (slot.start + ' - ' + slot.end)} • Grace: ${slot.start}-${minutesToTimeString(graceCutoffMins)}`,
                    statusBadge: isWithin10
                        ? `<span style="background: #DCFCE7; color: #166534; padding: 4px 12px; border-radius: 99px; font-weight: 800; font-size: 0.8rem;">🟢 ${slot.name} Active (${slot.start} - ${slot.end})</span>`
                        : `<span style="background: #FEE2E2; color: #991B1B; padding: 4px 12px; border-radius: 99px; font-weight: 800; font-size: 0.8rem;">🔴 10m Window Expired (${slot.name})</span>`
                };
            }
        }

        return {
            isHoliday: false,
            isOpen: false,
            sessionType: "Hourly (Off-schedule)",
            slotName: "No Active Hourly Slot",
            windowDesc: "Check hourly schedule timings",
            statusBadge: `<span style="background: #F1F5F9; color: #64748B; padding: 4px 12px; border-radius: 99px; font-weight: 800; font-size: 0.8rem;">⏳ No Active Hour Slot</span>`
        };
    }

    // --- Time Parsers & Helpers ---
    function parseTimeToMinutes(str) {
        if (!str) return 0;
        str = String(str).trim();
        const match12 = str.match(/(\d+):(\d+)(?::\d+)?\s*(AM|PM)?/i);
        if (match12) {
            let hrs = parseInt(match12[1], 10);
            const mins = parseInt(match12[2], 10);
            const ampm = match12[3] ? match12[3].toUpperCase() : null;
            if (ampm === "PM" && hrs < 12) hrs += 12;
            if (ampm === "AM" && hrs === 12) hrs = 0;
            return hrs * 60 + mins;
        }
        const parts = str.split(':');
        return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
    }

    function minutesToTimeString(totalMins, use12hr = true) {
        const hrs = Math.floor(totalMins / 60) % 24;
        const mins = totalMins % 60;
        if (!use12hr) {
            return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
        }
        const ampm = hrs >= 12 ? 'PM' : 'AM';
        const displayHrs = hrs % 12 || 12;
        return `${displayHrs}:${String(mins).padStart(2, '0')} ${ampm}`;
    }

    // --- Camera Handling ---
    async function startCamera(videoElement, preferredCameraId = null) {
        stopCamera();
        try {
            const constraints = {
                video: preferredCameraId ? { deviceId: { exact: preferredCameraId } } : {
                    facingMode: "user",
                    width: { ideal: 640 },
                    height: { ideal: 480 }
                },
                audio: false
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            window.FaceRecognitionState.activeStream = stream;
            if (videoElement) {
                videoElement.srcObject = stream;
                await videoElement.play();
            }
            return stream;
        } catch (err) {
            console.error("Camera access error:", err);
            alert("Unable to access camera. Please allow camera permissions in your browser.");
            return null;
        }
    }

    function stopCamera() {
        if (window.FaceRecognitionState.activeStream) {
            window.FaceRecognitionState.activeStream.getTracks().forEach(track => track.stop());
            window.FaceRecognitionState.activeStream = null;
        }
        if (window.FaceRecognitionState.kioskAnimationId) {
            cancelAnimationFrame(window.FaceRecognitionState.kioskAnimationId);
            window.FaceRecognitionState.kioskAnimationId = null;
        }
        window.FaceRecognitionState.isKioskScanning = false;
    }

    // --- Real-Time Attendance Affix Action ---
    async function markStudentAttendance(studentInfo, confidence = "98.5%", sessionInfo = null) {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

        const activeSlot = sessionInfo || getActiveScheduleStatus();
        const sessionType = activeSlot.sessionType || (now.getHours() < 13 ? "FN" : "AN");
        
        const schedules = window.FaceRecognitionState.schedules || DEFAULT_SCHEDULES;
        let status = "Present";
        if (schedules.schedule_mode === 'hourly') {
            status = activeSlot.isLate ? "Absent" : "Present";
        } else {
            status = activeSlot.isLate ? "Late" : "Present";
        }

        // Check duplicate in local state for today + session
        const isDuplicate = window.FaceRecognitionState.attendanceLogs.some(log =>
            log.date === dateStr &&
            log.reg_num.toUpperCase() === studentInfo.reg_num.toUpperCase() &&
            log.session_type.toUpperCase() === sessionType.toUpperCase()
        );

        if (isDuplicate) {
            console.log(`Attendance already marked today for ${studentInfo.name} in ${sessionType}`);
            return { duplicate: true, message: `Already marked for ${sessionType} today` };
        }

        const currentUser = JSON.parse(localStorage.getItem('user')) || {};
        const adminEmail = currentUser.email || currentUser.mailid || "Admin";

        const newLog = {
            log_id: "FACELOG_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
            date: dateStr,
            time: timeStr,
            timestamp: now.toISOString(),
            reg_num: studentInfo.reg_num,
            name: studentInfo.name,
            department: studentInfo.department || "",
            session_type: sessionType,
            status: status,
            confidence_score: confidence,
            admin_email: adminEmail,
            device_info: navigator.userAgent.substring(0, 50),
            remarks: "Face Recognized Real-time"
        };

        // Add to local state
        window.FaceRecognitionState.attendanceLogs.unshift(newLog);
        saveLocalState();
        playBeep('success');

        // Post to Google Apps Script Web App asynchronously
        const apiUrl = window.FaceRecognitionState.apiUrl;
        if (apiUrl) {
            fetch(apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: JSON.stringify({
                    action: "mark_face_attendance",
                    ...newLog
                })
            }).catch(e => console.warn("Failed background POST to sheet:", e));
        }

        renderKioskRecentAffixes();
        renderAnalyticsTable();
        return { success: true, log: newLog };
    }

    // --- Live Kiosk Scanning Loop ---
    function startKioskRecognitionLoop(video, canvas) {
        window.FaceRecognitionState.isKioskScanning = true;
        const faceapiLib = window.faceapi || (typeof faceapi !== 'undefined' ? faceapi : null);

        const scanningFeedbacks = [
            document.getElementById('face-scan-status-text'),
            document.getElementById('face-scan-status-text-mobile')
        ];

        const detectLoop = async () => {
            if (!window.FaceRecognitionState.isKioskScanning || !video || video.paused || video.ended) {
                return;
            }

            if (faceapiLib && window.FaceRecognitionState.modelsLoaded && video.readyState >= 2) {
                try {
                    const displaySize = { width: video.videoWidth || 640, height: video.videoHeight || 480 };
                    faceapiLib.matchDimensions(canvas, displaySize);

                    const detections = await faceapiLib
                        .detectAllFaces(video, new faceapiLib.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
                        .withFaceLandmarks()
                        .withFaceDescriptors();

                    const resizedDetections = faceapiLib.resizeResults(detections, displaySize);
                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, canvas.width, canvas.height);

                    if (detections.length === 0) {
                        scanningFeedbacks.forEach(el => {
                            if (el) el.innerHTML = `<span style="color: #64748B;">Looking for face in frame...</span>`;
                        });
                    } else {
                        // Face detected
                        detections.forEach((det, i) => {
                            const box = resizedDetections[i].detection.box;
                            let matchLabel = "Unknown Student";
                            let isMatch = false;
                            let studentMeta = null;
                            let confidenceScore = "95.0%";

                            if (window.FaceRecognitionState.matcher && det.descriptor) {
                                const bestMatch = window.FaceRecognitionState.matcher.findBestMatch(det.descriptor);
                                if (bestMatch.label !== 'unknown') {
                                    const parts = bestMatch.label.split('|||');
                                    studentMeta = {
                                        reg_num: parts[0],
                                        name: parts[1],
                                        department: parts[2] || ""
                                    };
                                    matchLabel = `${studentMeta.name} (${studentMeta.reg_num})`;
                                    isMatch = true;
                                    const score = Math.round((1 - bestMatch.distance) * 100);
                                    confidenceScore = `${score}%`;
                                }
                            }

                            // Draw glowing cyber box
                            ctx.save();
                            ctx.lineWidth = 3;
                            ctx.strokeStyle = isMatch ? "#10B981" : "#6366F1";
                            ctx.shadowColor = isMatch ? "rgba(16, 185, 129, 0.8)" : "rgba(99, 102, 241, 0.8)";
                            ctx.shadowBlur = 10;
                            ctx.strokeRect(box.x, box.y, box.width, box.height);

                            // Label banner
                            ctx.fillStyle = isMatch ? "rgba(16, 185, 129, 0.9)" : "rgba(15, 23, 42, 0.85)";
                            ctx.fillRect(box.x, box.y > 30 ? box.y - 28 : box.y + box.height, box.width, 26);
                            ctx.fillStyle = "#FFFFFF";
                            ctx.font = "bold 13px 'Google Sans', Inter, sans-serif";
                            ctx.fillText(matchLabel, box.x + 8, box.y > 30 ? box.y - 10 : box.y + box.height + 18);
                            ctx.restore();

                            // Trigger Affix if match found and not in cooldown
                            if (isMatch && studentMeta) {
                                const now = Date.now();
                                const isSame = window.FaceRecognitionState.lastRecognizedReg === studentMeta.reg_num;
                                const elapsed = now - window.FaceRecognitionState.lastRecognizedTime;

                                if (!isSame || elapsed > window.FaceRecognitionState.scanCooldownMs) {
                                    window.FaceRecognitionState.lastRecognizedReg = studentMeta.reg_num;
                                    window.FaceRecognitionState.lastRecognizedTime = now;

                                    markStudentAttendance(studentMeta, confidenceScore).then(res => {
                                        showRecognizedPopup(studentMeta, confidenceScore, res && res.duplicate);
                                    });
                                }
                            }
                        });
                    }
                } catch (loopErr) {
                    console.warn("Frame detection error:", loopErr);
                }
            }

            if (window.FaceRecognitionState.isKioskScanning) {
                window.FaceRecognitionState.kioskAnimationId = requestAnimationFrame(detectLoop);
            }
        };

        detectLoop();
    }

    function showRecognizedPopup(student, confidence, isDuplicate) {
        const popups = [
            {
                popup: document.getElementById('face-recognized-popup'),
                img: document.getElementById('face-popup-img'),
                name: document.getElementById('face-popup-name'),
                reg: document.getElementById('face-popup-reg'),
                status: document.getElementById('face-popup-status'),
                score: document.getElementById('face-popup-score')
            },
            {
                popup: document.getElementById('face-recognized-popup-mobile'),
                img: document.getElementById('face-popup-img-mobile'),
                name: document.getElementById('face-popup-name-mobile'),
                reg: document.getElementById('face-popup-reg-mobile'),
                status: document.getElementById('face-popup-status-mobile'),
                score: document.getElementById('face-popup-score-mobile')
            }
        ];

        // Find registered photo
        const regStudent = (window.FaceRecognitionState.registeredStudents || []).find(s => s.reg_num === student.reg_num);
        const photoSrc = (regStudent && regStudent.photo_thumbnail) ? regStudent.photo_thumbnail : 'profile.png';

        popups.forEach(p => {
            if (!p.popup) return;
            if (p.img) p.img.src = photoSrc;
            if (p.name) p.name.textContent = student.name;
            if (p.reg) p.reg.textContent = `${student.reg_num} • ${student.department || ''}`;
            if (p.score) p.score.textContent = `Match Confidence: ${confidence}`;

            if (p.status) {
                if (isDuplicate) {
                    p.status.innerHTML = `<span style="background: #FEF3C7; color: #D97706; padding: 4px 10px; border-radius: 99px; font-weight: 800; font-size: 0.75rem;">⚠️ Already Affixed Today</span>`;
                } else {
                    p.status.innerHTML = `<span style="background: #DCFCE7; color: #166534; padding: 4px 10px; border-radius: 99px; font-weight: 800; font-size: 0.75rem;">✅ Attendance Affixed Successfully!</span>`;
                }
            }

            p.popup.style.display = 'flex';
            p.popup.style.opacity = '1';
            p.popup.style.transform = 'translateY(0)';

            setTimeout(() => {
                p.popup.style.opacity = '0';
                p.popup.style.transform = 'translateY(20px)';
                setTimeout(() => { p.popup.style.display = 'none'; }, 300);
            }, 3200);
        });
    }

    // --- Face Registration Flow ---
    let registrationStream = null;
    let capturedDescriptor = null;
    let capturedThumbnail = null;

    async function initRegistrationCamera() {
        const isMobile = window.innerWidth <= 768 || (document.getElementById('admin-subview-face-recognition-mobile') && !document.getElementById('admin-subview-face-recognition-mobile').classList.contains('hidden'));
        const video = isMobile ? (document.getElementById('face-reg-video-mobile') || document.getElementById('face-reg-video')) : (document.getElementById('face-reg-video') || document.getElementById('face-reg-video-mobile'));
        if (!video) return;
        try {
            if (registrationStream) {
                registrationStream.getTracks().forEach(t => t.stop());
            }
            registrationStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
                audio: false
            });
            video.srcObject = registrationStream;
            await video.play();
        } catch (e) {
            console.error("Registration camera error:", e);
            alert("Unable to access camera for face registration. Please verify browser permissions.");
        }
    }

    function stopRegistrationCamera() {
        if (registrationStream) {
            registrationStream.getTracks().forEach(t => t.stop());
            registrationStream = null;
        }
    }

    async function captureAndAnalyzeFace(isMobileView = false) {
        const video = isMobileView ? (document.getElementById('face-reg-video-mobile') || document.getElementById('face-reg-video')) : (document.getElementById('face-reg-video') || document.getElementById('face-reg-video-mobile'));
        const canvas = isMobileView ? (document.getElementById('face-reg-canvas-mobile') || document.getElementById('face-reg-canvas')) : (document.getElementById('face-reg-canvas') || document.getElementById('face-reg-canvas-mobile'));
        const statusEl = isMobileView ? (document.getElementById('face-reg-analysis-status-mobile') || document.getElementById('face-reg-analysis-status')) : (document.getElementById('face-reg-analysis-status') || document.getElementById('face-reg-analysis-status-mobile'));
        const saveBtn = isMobileView ? (document.getElementById('face-reg-save-btn-mobile') || document.getElementById('face-reg-save-btn')) : (document.getElementById('face-reg-save-btn') || document.getElementById('face-reg-save-btn-mobile'));
        const faceapiLib = window.faceapi || (typeof faceapi !== 'undefined' ? faceapi : null);

        if (!video || !canvas) return;

        if (statusEl) statusEl.innerHTML = `<div class="spinner-border spinner-border-sm" style="width: 14px; height: 14px;"></div> Analyzing facial features...`;

        try {
            canvas.width = video.videoWidth || 640;
            canvas.height = video.videoHeight || 480;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            // Thumbnail snapshot
            capturedThumbnail = canvas.toDataURL('image/jpeg', 0.85);

            if (faceapiLib && window.FaceRecognitionState.modelsLoaded) {
                const detection = await faceapiLib
                    .detectSingleFace(canvas, new faceapiLib.TinyFaceDetectorOptions({ scoreThreshold: 0.5 }))
                    .withFaceLandmarks()
                    .withFaceDescriptor();

                if (!detection) {
                    if (statusEl) statusEl.innerHTML = `<span style="color: #EF4444; font-weight: 700;">❌ No face detected. Please face camera directly in good light.</span>`;
                    playBeep('warning');
                    return;
                }

                capturedDescriptor = Array.from(detection.descriptor);
                if (statusEl) statusEl.innerHTML = `<span style="color: #10B981; font-weight: 700;">✅ Face Vector Extracted (128 Dimensions)</span>`;
                if (saveBtn) saveBtn.disabled = false;
                // Also enable the other save button if both exist
                const altSaveBtn = isMobileView ? document.getElementById('face-reg-save-btn') : document.getElementById('face-reg-save-btn-mobile');
                if (altSaveBtn) altSaveBtn.disabled = false;
                playBeep('success');
            } else {
                // Fallback visual descriptor
                capturedDescriptor = [0.1, 0.2, 0.3];
                if (statusEl) statusEl.innerHTML = `<span style="color: #10B981; font-weight: 700;">✅ Snapshot Captured</span>`;
                if (saveBtn) saveBtn.disabled = false;
                const altSaveBtn = isMobileView ? document.getElementById('face-reg-save-btn') : document.getElementById('face-reg-save-btn-mobile');
                if (altSaveBtn) altSaveBtn.disabled = false;
            }
        } catch (err) {
            console.error("Face capture error:", err);
            if (statusEl) statusEl.innerHTML = `<span style="color: #EF4444;">Error during face capture.</span>`;
        }
    }

    async function saveFaceRegistration(isMobileView = false) {
        const nameInput = isMobileView ? (document.getElementById('face-reg-name-mobile') || document.getElementById('face-reg-name')) : (document.getElementById('face-reg-name') || document.getElementById('face-reg-name-mobile'));
        const regNumInput = isMobileView ? (document.getElementById('face-reg-regnum-mobile') || document.getElementById('face-reg-regnum')) : (document.getElementById('face-reg-regnum') || document.getElementById('face-reg-regnum-mobile'));
        const deptInput = isMobileView ? (document.getElementById('face-reg-dept-mobile') || document.getElementById('face-reg-dept')) : (document.getElementById('face-reg-dept') || document.getElementById('face-reg-dept-mobile'));
        const yearInput = isMobileView ? (document.getElementById('face-reg-year-mobile') || document.getElementById('face-reg-year')) : (document.getElementById('face-reg-year') || document.getElementById('face-reg-year-mobile'));
        const emailInput = isMobileView ? (document.getElementById('face-reg-email-mobile') || document.getElementById('face-reg-email')) : (document.getElementById('face-reg-email') || document.getElementById('face-reg-email-mobile'));

        const regNum = (regNumInput?.value || '').trim();
        const name = (nameInput?.value || '').trim();
        if (!regNum || !name) {
            alert("Please select or enter the student's details.");
            return;
        }

        if (!capturedDescriptor && !capturedThumbnail) {
            alert("Please capture the student's face before saving.");
            return;
        }

        const currentUser = JSON.parse(localStorage.getItem('user')) || {};
        const adminEmail = currentUser.email || currentUser.mailid || "Admin";

        const record = {
            reg_num: regNum,
            name: name,
            department: (deptInput?.value || '').trim(),
            year: (yearInput?.value || '').trim(),
            email: (emailInput?.value || '').trim(),
            descriptor: capturedDescriptor,
            photo_thumbnail: capturedThumbnail || 'profile.png',
            registered_at: new Date().toISOString(),
            registered_by: adminEmail,
            status: "Active"
        };

        // Update local list
        const existingIdx = window.FaceRecognitionState.registeredStudents.findIndex(s => s.reg_num.toUpperCase() === regNum.toUpperCase());
        if (existingIdx >= 0) {
            window.FaceRecognitionState.registeredStudents[existingIdx] = record;
        } else {
            window.FaceRecognitionState.registeredStudents.push(record);
        }

        saveLocalState();
        rebuildFaceMatcher();
        renderRegisteredFacesGrid();
        renderAnalyticsTable();

        // Send to Apps Script Web App
        const apiUrl = window.FaceRecognitionState.apiUrl;
        if (apiUrl) {
            fetch(apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: JSON.stringify({
                    action: "register_face",
                    ...record
                })
            }).catch(e => console.warn("Background sheet sync failed:", e));
        }

        alert(`Face profile successfully registered for ${name} (${regNum})!`);

        // Reset inputs
        capturedDescriptor = null;
        capturedThumbnail = null;
        const statusEl = document.getElementById('face-reg-analysis-status');
        if (statusEl) statusEl.innerHTML = '';
        const statusElMob = document.getElementById('face-reg-analysis-status-mobile');
        if (statusElMob) statusElMob.innerHTML = '';
        const saveBtn = document.getElementById('face-reg-save-btn');
        if (saveBtn) saveBtn.disabled = true;
        const saveBtnMob = document.getElementById('face-reg-save-btn-mobile');
        if (saveBtnMob) saveBtnMob.disabled = true;

        window.switchFaceTab('register');
    }

    function deleteRegisteredFace(regNum) {
        if (!confirm(`Are you sure you want to remove registered face for ${regNum}?`)) return;

        window.FaceRecognitionState.registeredStudents = window.FaceRecognitionState.registeredStudents.filter(s => s.reg_num !== regNum);
        saveLocalState();
        rebuildFaceMatcher();
        renderRegisteredFacesGrid();
        renderAnalyticsTable();

        const apiUrl = window.FaceRecognitionState.apiUrl;
        if (apiUrl) {
            fetch(apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: JSON.stringify({ action: "delete_face", reg_num: regNum })
            }).catch(e => console.warn(e));
        }
    }

    // --- Render Views & Tabs ---
    function renderRegisteredFacesGrid() {
        const list = window.FaceRecognitionState.registeredStudents || [];
        const searchInput = document.getElementById('face-search-registered') || document.getElementById('face-reg-student-search-mobile');
        const query = (searchInput ? searchInput.value : '').toLowerCase().trim();

        const filtered = list.filter(s =>
            (s.name && s.name.toLowerCase().includes(query)) ||
            (s.reg_num && s.reg_num.toLowerCase().includes(query)) ||
            (s.department && s.department.toLowerCase().includes(query))
        );

        // Desktop Grid
        const container = document.getElementById('face-registered-list-grid');
        if (container) {
            if (filtered.length === 0) {
                container.innerHTML = `
                    <div style="grid-column: 1 / -1; padding: 3rem; text-align: center; background: white; border-radius: 20px; border: 1.5px dashed #CBD5E1;">
                        <i data-lucide="user-x" style="width: 40px; height: 40px; color: #94A3B8; margin-bottom: 10px;"></i>
                        <h4 style="font-size: 1.05rem; font-weight: 800; color: #1E293B; margin-bottom: 4px;">No Registered Faces</h4>
                        <p style="color: #64748B; font-size: 0.82rem; margin: 0;">Register student faces to enable automatic attendance verification.</p>
                    </div>
                `;
            } else {
                container.innerHTML = filtered.map(s => `
                    <div class="card no-hover-card" style="padding: 1.25rem; border-radius: 20px; border: 1.5px solid #F1F5F9; background: white; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 4px 16px rgba(0,0,0,0.02); transform: none !important; transition: none !important;">
                        <div style="display: flex; gap: 12px; align-items: center;">
                            <img src="${s.photo_thumbnail || 'profile.png'}" alt="${s.name}" 
                                style="width: 52px; height: 52px; border-radius: 14px; object-fit: cover; border: 2px solid #EDE9FE; flex-shrink: 0;"
                                onerror="this.src='profile.png'">
                            <div style="flex: 1; min-width: 0;">
                                <h4 style="font-size: 0.95rem; font-weight: 800; color: #0F172A; margin: 0 0 2px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${s.name}</h4>
                                <p style="font-size: 0.8rem; font-weight: 700; color: #6366F1; margin: 0 0 2px 0;">${s.reg_num}</p>
                                <p style="font-size: 0.72rem; color: #64748B; margin: 0;">${s.department || 'Information Technology'}</p>
                            </div>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #F8FAFC; padding-top: 8px;">
                            <span style="font-size: 0.72rem; color: #166534; font-weight: 800; background: #DCFCE7; padding: 2px 8px; border-radius: 99px; display: inline-flex; align-items: center; gap: 4px;">
                                ● Enrolled
                            </span>
                            <button onclick="window.deleteFaceStudent('${s.reg_num}')" 
                                style="background: #FEF2F2; color: #EF4444; border: none; padding: 4px 10px; border-radius: 8px; font-size: 0.75rem; font-weight: 700; cursor: pointer;">
                                Delete
                            </button>
                        </div>
                    </div>
                `).join('');
            }
        }

        // Mobile List (Individual sleek cards)
        const containerMob = document.getElementById('face-registered-list-grid-mobile');
        if (containerMob) {
            if (filtered.length === 0) {
                containerMob.innerHTML = `<div style="text-align: center; padding: 2rem 1rem; color: #94A3B8; font-size: 0.82rem; background: white; border-radius: 14px; border: 1.5px dashed #E2E8F0;">No registered faces found.</div>`;
            } else {
                containerMob.innerHTML = filtered.map(s => `
                    <div class="card no-hover-card" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: white; border-radius: 14px; border: 1.5px solid #F1F5F9; box-shadow: 0 2px 8px rgba(0,0,0,0.02); transform: none !important;">
                        <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                            <img src="${s.photo_thumbnail || 'profile.png'}" alt="${s.name}" 
                                style="width: 42px; height: 42px; border-radius: 12px; object-fit: cover; border: 1.5px solid #EDE9FE; flex-shrink: 0;"
                                onerror="this.src='profile.png'">
                            <div style="min-width: 0;">
                                <div style="font-weight: 800; font-size: 0.88rem; color: #0F172A; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${s.name}</div>
                                <div style="font-size: 0.72rem; color: #6366F1; font-weight: 700;">${s.reg_num} <span style="color: #94A3B8;">•</span> <span style="color: #64748B; font-weight: 600;">${s.department || ''}</span></div>
                            </div>
                        </div>
                        <button onclick="window.deleteFaceStudent('${s.reg_num}')" 
                            style="background: #FEF2F2; color: #EF4444; border: none; padding: 5px 10px; border-radius: 8px; font-size: 0.72rem; font-weight: 700; cursor: pointer; flex-shrink: 0; margin-left: 8px;">
                            Delete
                        </button>
                    </div>
                `).join('');
            }
        }

        if (window.lucide) lucide.createIcons();
    }

    function renderKioskRecentAffixes() {
        const logs = window.FaceRecognitionState.attendanceLogs || [];
        const todayStr = new Date().toISOString().split('T')[0];
        const todayLogs = logs.filter(l => l.date === todayStr).slice(0, 10);

        const countBadges = [
            document.getElementById('face-kiosk-today-count'),
            document.getElementById('face-kiosk-today-count-mobile')
        ];
        countBadges.forEach(b => { if (b) b.textContent = todayLogs.length; });

        // Desktop List
        const container = document.getElementById('face-kiosk-recent-logs');
        if (container) {
            if (todayLogs.length === 0) {
                container.innerHTML = `<p style="color: #94A3B8; font-size: 0.85rem; text-align: center; padding: 2rem 0;">No attendance scans recorded today yet.</p>`;
            } else {
                container.innerHTML = todayLogs.map(l => `
                    <div class="card no-hover-card" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: white; border-radius: 14px; border: 1.5px solid #F1F5F9; box-shadow: 0 2px 8px rgba(0,0,0,0.02); transform: none !important;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <div style="width: 36px; height: 36px; border-radius: 10px; background: #ECFDF5; color: #10B981; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.85rem;">
                                ✓
                            </div>
                            <div>
                                <div style="font-weight: 800; font-size: 0.88rem; color: #0F172A;">${l.name}</div>
                                <div style="font-size: 0.72rem; color: #64748B;">${l.reg_num} <span style="color: #CBD5E1;">•</span> <span style="color: #6366F1; font-weight: 700;">${l.session_type}</span></div>
                            </div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-weight: 800; font-size: 0.82rem; color: #0F172A;">${l.time}</div>
                            <span style="font-size: 0.68rem; color: #166534; font-weight: 800; background: #DCFCE7; padding: 2px 8px; border-radius: 99px;">Affixed</span>
                        </div>
                    </div>
                `).join('');
            }
        }

        // Mobile List
        const containerMob = document.getElementById('face-kiosk-recent-logs-mobile');
        if (containerMob) {
            if (todayLogs.length === 0) {
                containerMob.innerHTML = `<p style="color: #94A3B8; font-size: 0.8rem; text-align: center; padding: 1.5rem 0;">No attendance scans recorded today yet.</p>`;
            } else {
                containerMob.innerHTML = todayLogs.map(l => `
                    <div class="card no-hover-card" style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: white; border-radius: 12px; border: 1.5px solid #F1F5F9; box-shadow: 0 2px 6px rgba(0,0,0,0.02); transform: none !important;">
                        <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                            <div style="width: 28px; height: 28px; border-radius: 8px; background: #ECFDF5; color: #10B981; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.75rem; flex-shrink: 0;">
                                ✓
                            </div>
                            <div style="min-width: 0;">
                                <div style="font-weight: 800; font-size: 0.82rem; color: #0F172A; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${l.name}</div>
                                <div style="font-size: 0.7rem; color: #64748B;">${l.reg_num} <span style="color: #CBD5E1;">•</span> <span style="color: #6366F1; font-weight: 700;">${l.session_type}</span></div>
                            </div>
                        </div>
                        <div style="text-align: right; flex-shrink: 0; margin-left: 8px;">
                            <div style="font-weight: 800; font-size: 0.75rem; color: #0F172A;">${l.time}</div>
                            <span style="font-size: 0.65rem; color: #166534; font-weight: 800; background: #DCFCE7; padding: 1px 6px; border-radius: 99px;">Affixed</span>
                        </div>
                    </div>
                `).join('');
            }
        }
    }

    function renderAnalyticsTable() {
        const registered = window.FaceRecognitionState.registeredStudents || [];
        const logs = window.FaceRecognitionState.attendanceLogs || [];
        const todayStr = new Date().toISOString().split('T')[0];
        const todayLogs = logs.filter(l => l.date === todayStr);

        // Calculate unique present students today
        const presentSet = new Set(todayLogs.map(l => l.reg_num.toUpperCase()));
        const presentCount = presentSet.size;
        const totalRegistered = registered.length;
        const absentCount = Math.max(0, totalRegistered - presentCount);
        const ratePct = totalRegistered > 0 ? Math.round((presentCount / totalRegistered) * 100) : 0;

        // Desktop KPI
        const kpiTotal = document.getElementById('face-kpi-total-registered');
        const kpiPresent = document.getElementById('face-kpi-today-present');
        const kpiAbsent = document.getElementById('face-kpi-today-absent');
        const kpiRate = document.getElementById('face-kpi-attendance-rate');
        if (kpiTotal) kpiTotal.textContent = totalRegistered;
        if (kpiPresent) kpiPresent.textContent = presentCount;
        if (kpiAbsent) kpiAbsent.textContent = absentCount;
        if (kpiRate) kpiRate.textContent = `${ratePct}%`;

        // Mobile KPI
        const kpiTotalMob = document.getElementById('face-kpi-total-registered-mobile');
        const kpiPresentMob = document.getElementById('face-kpi-today-present-mobile');
        const kpiAbsentMob = document.getElementById('face-kpi-today-absent-mobile');
        const kpiRateMob = document.getElementById('face-kpi-attendance-rate-mobile');
        if (kpiTotalMob) kpiTotalMob.textContent = totalRegistered;
        if (kpiPresentMob) kpiPresentMob.textContent = presentCount;
        if (kpiAbsentMob) kpiAbsentMob.textContent = absentCount;
        if (kpiRateMob) kpiRateMob.textContent = `${ratePct}%`;

        const dateFilter = (document.getElementById('face-filter-date') || document.getElementById('face-filter-date-mobile') || {}).value || "";
        const searchFilter = ((document.getElementById('face-filter-search') || document.getElementById('face-filter-search-mobile') || {}).value || "").toLowerCase().trim();
        const sessionFilter = (document.getElementById('face-filter-session') || document.getElementById('face-filter-session-mobile') || {}).value || "ALL";

        const filteredLogs = logs.filter(l => {
            if (dateFilter && l.date !== dateFilter) return false;
            if (sessionFilter !== "ALL" && l.session_type !== sessionFilter) return false;
            if (searchFilter && !l.name.toLowerCase().includes(searchFilter) && !l.reg_num.toLowerCase().includes(searchFilter)) return false;
            return true;
        });

        // Desktop Table
        const tbody = document.getElementById('face-analytics-tbody');
        if (tbody) {
            if (filteredLogs.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 2.5rem; color: #94A3B8;">No attendance history found matching current filters.</td></tr>`;
            } else {
                tbody.innerHTML = filteredLogs.map((l, idx) => `
                    <tr style="border-bottom: 1px solid #F1F5F9;">
                        <td style="padding: 12px 16px; font-weight: 700; color: #64748B; font-size: 0.8rem;">${idx + 1}</td>
                        <td style="padding: 12px 16px;">
                            <div style="font-weight: 800; color: #0F172A; font-size: 0.85rem;">${l.date}</div>
                            <div style="font-size: 0.72rem; color: #64748B;">${l.time}</div>
                        </td>
                        <td style="padding: 12px 16px;">
                            <div style="font-weight: 800; color: #0F172A; font-size: 0.9rem;">${l.name}</div>
                            <div style="font-size: 0.75rem; color: #6366F1; font-weight: 700;">${l.reg_num}</div>
                        </td>
                        <td style="padding: 12px 16px; font-size: 0.85rem; color: #475569;">${l.department || 'Design Series'}</td>
                        <td style="padding: 12px 16px;">
                            <span style="background: #F1F5F9; color: #334155; padding: 4px 10px; border-radius: 99px; font-weight: 800; font-size: 0.75rem;">${l.session_type}</span>
                        </td>
                        <td style="padding: 12px 16px; font-size: 0.8rem; font-weight: 700; color: #10B981;">
                            ${l.confidence_score || '98%'}
                        </td>
                        <td style="padding: 12px 16px;">
                            <span style="background: #DCFCE7; color: #166534; padding: 4px 12px; border-radius: 99px; font-weight: 800; font-size: 0.75rem;">
                                ${l.status || 'Present'}
                            </span>
                        </td>
                    </tr>
                `).join('');
            }
        }

        // Mobile List (Separate Cards matching Student Portal UX)
        const mobList = document.getElementById('face-analytics-mobile-list') || document.getElementById('face-analytics-list-mobile');
        if (mobList) {
            if (filteredLogs.length === 0) {
                mobList.innerHTML = `
                    <div style="text-align: center; padding: 2.25rem 1.5rem; background: white; border-radius: 16px; border: 1.5px dashed #E2E8F0;">
                        <div style="font-size: 0.9rem; font-weight: 800; color: #1E293B;">No Attendance Records Found</div>
                        <div style="font-size: 0.75rem; color: #64748B; margin-top: 3px;">Try adjusting search terms or date filter</div>
                    </div>
                `;
            } else {
                mobList.innerHTML = filteredLogs.map((l, idx) => {
                    const isPresent = (l.status || '').toLowerCase().includes('present');
                    const statusBg = isPresent ? '#DCFCE7' : '#FEF3C7';
                    const statusColor = isPresent ? '#166534' : '#B45309';
                    return `
                        <div class="card no-hover-card" style="background: white; border-radius: 16px; border: 1.5px solid #F1F5F9; padding: 0.95rem 1.15rem; box-shadow: 0 2px 8px rgba(0,0,0,0.02); display: flex; flex-direction: column; gap: 8px; transform: none !important;">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                                <div>
                                    <div style="font-weight: 800; color: #0F172A; font-size: 0.92rem;">${l.name}</div>
                                    <div style="font-size: 0.75rem; color: #6366F1; font-weight: 700; margin-top: 1px;">${l.reg_num} • <span style="color: #64748B; font-weight: 600;">${l.department || 'Design Series'}</span></div>
                                </div>
                                <span style="background: ${statusBg}; color: ${statusColor}; padding: 3px 9px; border-radius: 99px; font-weight: 800; font-size: 0.7rem;">
                                    ${l.status || 'Present'}
                                </span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #F8FAFC; padding-top: 8px; margin-top: 2px; font-size: 0.72rem; color: #64748B;">
                                <div style="display: flex; align-items: center; gap: 4px;">
                                    <span>📅 ${l.date}</span>
                                    <span>•</span>
                                    <span>${l.time}</span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <span style="background: #F1F5F9; color: #334155; padding: 2px 8px; border-radius: 6px; font-weight: 700;">${l.session_type}</span>
                                    <span style="color: #10B981; font-weight: 700;">${l.confidence_score || '98%'}</span>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }
    }

    function formatTime12hr(time24) {
        if (!time24) return '';
        const parts = String(time24).split(':');
        if (parts.length < 2) return time24;
        let h = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        if (isNaN(h) || isNaN(m)) return time24;
        const period = h >= 12 ? 'PM' : 'AM';
        const hour12 = h % 12 || 12;
        return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
    }

    function computeGraceBadgeText(startStr, graceMins) {
        if (!startStr) return '';
        const parts = String(startStr).split(':');
        if (parts.length < 2) return '';
        const h = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        if (isNaN(h) || isNaN(m)) return '';
        const totalMins = h * 60 + m + (parseInt(graceMins, 10) || 0);
        const endH = Math.floor(totalMins / 60) % 24;
        const endM = totalMins % 60;
        const period = endH >= 12 ? 'PM' : 'AM';
        const hour12 = endH % 12 || 12;
        return `Grace ≤ ${hour12}:${String(endM).padStart(2, '0')} ${period}`;
    }

    window.onFaceSlotInputChanged = function (slotIndex) {
        const start = document.getElementById(`face-slot-start-${slotIndex}`)?.value || '';
        const grace = document.getElementById(`face-slot-grace-${slotIndex}`)?.value || '10';
        const badge = document.getElementById(`face-slot-badge-${slotIndex}`);
        if (badge && start) {
            badge.textContent = computeGraceBadgeText(start, grace);
        }
    };

    window.onFaceSlotInputChangedMobile = function (slotIndex) {
        const start = document.getElementById(`face-slot-start-mob-${slotIndex}`)?.value || '';
        const grace = document.getElementById(`face-slot-grace-mob-${slotIndex}`)?.value || '10';
        const badge = document.getElementById(`face-slot-badge-mob-${slotIndex}`);
        if (badge && start) {
            badge.textContent = computeGraceBadgeText(start, grace);
        }
    };

    window.onFaceScheduleModeChanged = function () {
        const mode = document.getElementById('face-sched-mode')?.value || 'hourly';
        const sessCont = document.getElementById('face-session-schedule-container');
        const hourlyCont = document.getElementById('face-hourly-schedule-container');
        if (sessCont && hourlyCont) {
            if (mode === 'session') {
                sessCont.style.display = 'flex';
                hourlyCont.style.display = 'none';
            } else {
                sessCont.style.display = 'none';
                hourlyCont.style.display = 'block';
            }
        }
    };

    window.onFaceScheduleModeChangedMobile = function () {
        const mode = document.getElementById('face-sched-mode-mobile')?.value || 'hourly';
        const sessCont = document.getElementById('face-session-schedule-container-mobile');
        const hourlyCont = document.getElementById('face-hourly-schedule-container-mobile');
        if (sessCont && hourlyCont) {
            if (mode === 'session') {
                sessCont.style.display = 'flex';
                hourlyCont.style.display = 'none';
            } else {
                sessCont.style.display = 'none';
                hourlyCont.style.display = 'flex';
            }
        }
    };

    function renderSchedulesAndHolidays() {
        const sched = window.FaceRecognitionState.schedules || DEFAULT_SCHEDULES;
        const holidays = window.FaceRecognitionState.holidays || [];
        const slots = (sched.hourly_slots && sched.hourly_slots.length === 7)
            ? sched.hourly_slots
            : DEFAULT_SCHEDULES.hourly_slots;

        // Desktop Inputs
        const modeSelect = document.getElementById('face-sched-mode');
        const fnStart = document.getElementById('face-sched-fn-start');
        const fnEnd = document.getElementById('face-sched-fn-end');
        const fnGrace = document.getElementById('face-sched-fn-grace');
        const anStart = document.getElementById('face-sched-an-start');
        const anEnd = document.getElementById('face-sched-an-end');
        const anGrace = document.getElementById('face-sched-an-grace');

        if (modeSelect) modeSelect.value = sched.schedule_mode || 'hourly';
        if (fnStart) fnStart.value = sched.fn_start_time || '08:30';
        if (fnEnd) fnEnd.value = sched.fn_end_time || '12:30';
        if (fnGrace) fnGrace.value = sched.fn_grace_minutes || '15';
        if (anStart) anStart.value = sched.an_start_time || '13:30';
        if (anEnd) anEnd.value = sched.an_end_time || '17:30';
        if (anGrace) anGrace.value = sched.an_grace_minutes || '15';

        // Desktop Hourly Slots (7 Periods)
        slots.forEach((slot, i) => {
            const startInput = document.getElementById(`face-slot-start-${i}`);
            const endInput = document.getElementById(`face-slot-end-${i}`);
            const graceInput = document.getElementById(`face-slot-grace-${i}`);
            const badge = document.getElementById(`face-slot-badge-${i}`);

            if (startInput) startInput.value = slot.start || '08:45';
            if (endInput) endInput.value = slot.end || '09:35';
            if (graceInput) graceInput.value = slot.grace_minutes !== undefined ? slot.grace_minutes : 10;
            if (badge) badge.textContent = computeGraceBadgeText(slot.start || '08:45', slot.grace_minutes || 10);
        });

        // Mobile Inputs
        const modeSelectMob = document.getElementById('face-sched-mode-mobile');
        const fnStartMob = document.getElementById('face-sched-fn-start-mobile');
        const fnEndMob = document.getElementById('face-sched-fn-end-mobile');
        const fnGraceMob = document.getElementById('face-sched-fn-grace-mobile');
        const anStartMob = document.getElementById('face-sched-an-start-mobile');
        const anEndMob = document.getElementById('face-sched-an-end-mobile');
        const anGraceMob = document.getElementById('face-sched-an-grace-mobile');

        if (modeSelectMob) modeSelectMob.value = sched.schedule_mode || 'hourly';
        if (fnStartMob) fnStartMob.value = sched.fn_start_time || '08:30';
        if (fnEndMob) fnEndMob.value = sched.fn_end_time || '12:30';
        if (fnGraceMob) fnGraceMob.value = sched.fn_grace_minutes || '15';
        if (anStartMob) anStartMob.value = sched.an_start_time || '13:30';
        if (anEndMob) anEndMob.value = sched.an_end_time || '17:30';
        if (anGraceMob) anGraceMob.value = sched.an_grace_minutes || '15';

        // Mobile Hourly Slots (7 Periods)
        slots.forEach((slot, i) => {
            const startInputMob = document.getElementById(`face-slot-start-mob-${i}`);
            const endInputMob = document.getElementById(`face-slot-end-mob-${i}`);
            const graceInputMob = document.getElementById(`face-slot-grace-mob-${i}`);
            const badgeMob = document.getElementById(`face-slot-badge-mob-${i}`);

            if (startInputMob) startInputMob.value = slot.start || '08:45';
            if (endInputMob) endInputMob.value = slot.end || '09:35';
            if (graceInputMob) graceInputMob.value = slot.grace_minutes !== undefined ? slot.grace_minutes : 10;
            if (badgeMob) badgeMob.textContent = computeGraceBadgeText(slot.start || '08:45', slot.grace_minutes || 10);
        });

        // Update container displays
        if (window.onFaceScheduleModeChanged) window.onFaceScheduleModeChanged();
        if (window.onFaceScheduleModeChangedMobile) window.onFaceScheduleModeChangedMobile();

        // Desktop Holidays list
        const holListCont = document.getElementById('face-holidays-list-container');
        if (holListCont) {
            if (holidays.length === 0) {
                holListCont.innerHTML = `<p style="color: #94A3B8; font-size: 0.85rem; padding: 1rem 0;">No holiday exceptions scheduled yet.</p>`;
            } else {
                holListCont.innerHTML = holidays.map(h => `
                    <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: white; border-radius: 14px; border: 1.5px solid #FEE2E2; margin-bottom: 8px;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <div style="width: 38px; height: 38px; border-radius: 10px; background: #FEE2E2; color: #DC2626; display: flex; align-items: center; justify-content: center; font-weight: 800;">
                                🏖️
                            </div>
                            <div>
                                <div style="font-weight: 800; font-size: 0.9rem; color: #0F172A;">${h.title}</div>
                                <div style="font-size: 0.75rem; color: #64748B;">${h.holiday_date} • <span style="color: #DC2626; font-weight: 700;">${h.type || 'Full Day'}</span></div>
                            </div>
                        </div>
                        <button onclick="window.deleteFaceHoliday('${h.holiday_date}')" 
                            style="background: #FEF2F2; color: #EF4444; border: none; padding: 6px 12px; border-radius: 8px; font-weight: 700; font-size: 0.75rem; cursor: pointer;">
                            Remove
                        </button>
                    </div>
                `).join('');
            }
        }

        // Mobile Holidays list
        const holListContMob = document.getElementById('face-holidays-list-container-mobile');
        if (holListContMob) {
            if (holidays.length === 0) {
                holListContMob.innerHTML = `<p style="color: #94A3B8; font-size: 0.8rem; padding: 0.75rem 0;">No holidays scheduled.</p>`;
            } else {
                holListContMob.innerHTML = holidays.map(h => `
                    <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: white; border-radius: 12px; border: 1.5px solid #FEE2E2; margin-bottom: 6px;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 1.1rem;">🏖️</span>
                            <div>
                                <div style="font-weight: 800; font-size: 0.85rem; color: #0F172A;">${h.title}</div>
                                <div style="font-size: 0.7rem; color: #64748B;">${h.holiday_date} • <span style="color: #DC2626; font-weight: 700;">${h.type || 'Full Day'}</span></div>
                            </div>
                        </div>
                        <button onclick="window.deleteFaceHoliday('${h.holiday_date}')" 
                            style="background: #FEF2F2; color: #EF4444; border: none; padding: 4px 8px; border-radius: 6px; font-weight: 700; font-size: 0.7rem; cursor: pointer;">
                            Remove
                        </button>
                    </div>
                `).join('');
            }
        }
    }

    function renderAllFaceViews() {
        renderRegisteredFacesGrid();
        renderKioskRecentAffixes();
        renderAnalyticsTable();
        renderSchedulesAndHolidays();
        updateKioskScheduleBadge();
    }

    function updateKioskScheduleBadge() {
        const status = getActiveScheduleStatus();
        const badgeEl = document.getElementById('face-kiosk-live-slot-badge');
        if (badgeEl) badgeEl.innerHTML = status.statusBadge;
        const badgeElMob = document.getElementById('face-kiosk-live-slot-badge-mobile');
        if (badgeElMob) badgeElMob.innerHTML = status.statusBadge;
    }

    // --- Global Window Exports ---
    window.switchFaceTab = function (tabName) {
        window.FaceRecognitionState.activeTab = tabName;
        const tabs = ['kiosk', 'register', 'schedules', 'analytics', 'settings'];
        tabs.forEach(t => {
            // Desktop buttons and panes
            const btn = document.getElementById(`face-tab-btn-${t}`);
            const pane = document.getElementById(`face-pane-${t}`);
            if (btn) {
                if (t === tabName) {
                    btn.classList.add('active');
                    btn.style.background = '#6366F1';
                    btn.style.color = 'white';
                } else {
                    btn.classList.remove('active');
                    btn.style.background = 'white';
                    btn.style.color = '#475569';
                }
            }
            if (pane) {
                pane.style.display = (t === tabName) ? 'block' : 'none';
            }

            // Mobile buttons and panes
            const btnMob = document.getElementById(`face-tab-btn-${t}-mobile`);
            const paneMob = document.getElementById(`face-pane-${t}-mobile`);
            if (btnMob) {
                if (t === tabName) {
                    btnMob.classList.add('active');
                    btnMob.style.background = '#6366F1';
                    btnMob.style.color = 'white';
                } else {
                    btnMob.classList.remove('active');
                    btnMob.style.background = 'white';
                    btnMob.style.color = '#475569';
                }
            }
            if (paneMob) {
                paneMob.style.display = (t === tabName) ? 'block' : 'none';
            }
        });

        const isMobileView = window.innerWidth <= 768 || (document.getElementById('admin-subview-face-recognition-mobile') && !document.getElementById('admin-subview-face-recognition-mobile').classList.contains('hidden'));

        // Tab specific transitions
        if (tabName === 'kiosk') {
            stopRegistrationCamera();
            const video = isMobileView ? (document.getElementById('face-kiosk-video-mobile') || document.getElementById('face-kiosk-video')) : (document.getElementById('face-kiosk-video') || document.getElementById('face-kiosk-video-mobile'));
            const canvas = isMobileView ? (document.getElementById('face-kiosk-canvas-mobile') || document.getElementById('face-kiosk-canvas')) : (document.getElementById('face-kiosk-canvas') || document.getElementById('face-kiosk-canvas-mobile'));

            if (video && canvas) {
                startCamera(video).then(() => {
                    startKioskRecognitionLoop(video, canvas);
                });
            }
        } else if (tabName === 'register') {
            stopCamera();
            initRegistrationCamera();
            renderRegisteredFacesGrid();
            populateStudentSearchDropdown();
        } else {
            stopCamera();
            stopRegistrationCamera();
            if (tabName === 'schedules') renderSchedulesAndHolidays();
            if (tabName === 'analytics') renderAnalyticsTable();
        }
    };

    async function populateStudentSearchDropdown(searchTerm = '') {
        const selects = [
            document.getElementById('face-reg-student-select'),
            document.getElementById('face-reg-student-select-mobile')
        ].filter(Boolean);

        if (selects.length === 0) return;

        let students = window.cachedAdminData || [];

        // If cachedAdminData is empty, auto-fetch from student database
        if (!students || students.length === 0) {
            try {
                selects.forEach(s => {
                    if (s.options.length <= 1) s.innerHTML = `<option value="">⏳ Loading students...</option>`;
                });

                const localUser = JSON.parse(localStorage.getItem('user') || '{}');
                const adminEmail = localUser.email || localUser.email_id || localUser.mailid || '';

                if (typeof window.loadAdminData === 'function') {
                    await window.loadAdminData(false);
                    students = window.cachedAdminData || [];
                }

                if (!students || students.length === 0) {
                    const portalApi = typeof API_URL !== 'undefined' ? API_URL : "https://script.google.com/macros/s/AKfycbwbm6TMHUJRn2Ja30C7s0PuKV_TkkOr5Tm76v8XH32mfa0svc0ZkSxvfNowQZhHr30cew/exec";
                    const url = `${portalApi}?adminAction=getAllUsers&adminEmail=${encodeURIComponent(adminEmail)}`;
                    const res = await fetch(url);
                    const data = await res.json();
                    if (data && data.status === 'success' && Array.isArray(data.users)) {
                        students = data.users;
                        window.cachedAdminData = data.users;
                    }
                }
            } catch (e) {
                console.warn("Could not fetch student database for face registration:", e);
            }
        }

        // Fallback to local student database if available
        if (!students || students.length === 0) {
            students = window.STUDENT_DATABASE || [];
        }

        // Filter and sort students
        const validStudents = (students || []).filter(s => {
            const reg = String(s.reg_num || s.roll_no || s.roll_num || s.rollNo || '').trim();
            const name = String(s.name || '').trim();
            if (!reg && !name) return false;
            if (!searchTerm) return true;
            const term = searchTerm.toLowerCase();
            const dept = String(s.department || s.dept || '').toLowerCase();
            return reg.toLowerCase().includes(term) || name.toLowerCase().includes(term) || dept.includes(term);
        }).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

        selects.forEach(select => {
            if (validStudents.length === 0) {
                select.innerHTML = `<option value="">-- No matching students found --</option>`;
                return;
            }

            select.innerHTML = `<option value="">-- Select Student (${validStudents.length}) --</option>` +
                validStudents.map(s => {
                    const reg = s.reg_num || s.roll_no || s.roll_num || s.rollNo || '';
                    const name = s.name || '';
                    const dept = s.department || s.dept || '';
                    const yr = s.year || s.current_year || '2nd Year';
                    const email = s.email || s.mailid || s.email_id || s.studentemail || '';
                    return `<option value="${reg}" data-name="${name.replace(/"/g, '&quot;')}" data-dept="${dept.replace(/"/g, '&quot;')}" data-year="${yr}" data-email="${email.replace(/"/g, '&quot;')}">${name} (${reg}) - ${dept}</option>`;
                }).join('');
        });
    }

    window.refreshFaceStudentList = function (force = true) {
        if (typeof window.loadAdminData === 'function') {
            window.loadAdminData(force).then(() => {
                populateStudentSearchDropdown();
            });
        } else {
            window.cachedAdminData = null;
            populateStudentSearchDropdown();
        }
    };

    window.onFaceStudentSearch = function (term) {
        populateStudentSearchDropdown(term);
    };

    window.onFaceStudentSearchMobile = function (term) {
        populateStudentSearchDropdown(term);
    };

    window.onFaceStudentSelectChanged = function () {
        const select = document.getElementById('face-reg-student-select');
        if (!select) return;
        const selectedOpt = select.options[select.selectedIndex];
        if (!selectedOpt || !selectedOpt.value) return;

        const nameInput = document.getElementById('face-reg-name');
        const regNumInput = document.getElementById('face-reg-regnum');
        const deptInput = document.getElementById('face-reg-dept');
        const yearInput = document.getElementById('face-reg-year');
        const emailInput = document.getElementById('face-reg-email');

        if (nameInput) nameInput.value = selectedOpt.dataset.name || '';
        if (regNumInput) regNumInput.value = selectedOpt.value || '';
        if (deptInput) deptInput.value = selectedOpt.dataset.dept || '';
        if (yearInput) yearInput.value = selectedOpt.dataset.year || '2nd Year';
        if (emailInput) emailInput.value = selectedOpt.dataset.email || '';
    };

    window.onFaceStudentSelectChangedMobile = function () {
        const select = document.getElementById('face-reg-student-select-mobile');
        if (!select) return;
        const selectedOpt = select.options[select.selectedIndex];
        if (!selectedOpt || !selectedOpt.value) return;

        const nameInput = document.getElementById('face-reg-name-mobile');
        const regNumInput = document.getElementById('face-reg-regnum-mobile');
        const deptInput = document.getElementById('face-reg-dept-mobile');
        const yearInput = document.getElementById('face-reg-year-mobile');
        const emailInput = document.getElementById('face-reg-email-mobile');

        if (nameInput) nameInput.value = selectedOpt.dataset.name || '';
        if (regNumInput) regNumInput.value = selectedOpt.value || '';
        if (deptInput) deptInput.value = selectedOpt.dataset.dept || '';
        if (yearInput) yearInput.value = selectedOpt.dataset.year || '2nd Year';
        if (emailInput) emailInput.value = selectedOpt.dataset.email || '';
    };

    window.saveFaceSchedules = function () {
        const mode = document.getElementById('face-sched-mode')?.value || 'hourly';
        const fnStart = document.getElementById('face-sched-fn-start')?.value || '08:30';
        const fnEnd = document.getElementById('face-sched-fn-end')?.value || '12:30';
        const fnGrace = document.getElementById('face-sched-fn-grace')?.value || '15';
        const anStart = document.getElementById('face-sched-an-start')?.value || '13:30';
        const anEnd = document.getElementById('face-sched-an-end')?.value || '17:30';
        const anGrace = document.getElementById('face-sched-an-grace')?.value || '15';

        const ordinals = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th"];
        const defaultSlots = DEFAULT_SCHEDULES.hourly_slots;
        const hourlySlots = [];

        for (let i = 0; i < 7; i++) {
            const start = document.getElementById(`face-slot-start-${i}`)?.value || defaultSlots[i].start;
            const end = document.getElementById(`face-slot-end-${i}`)?.value || defaultSlots[i].end;
            const graceVal = document.getElementById(`face-slot-grace-${i}`)?.value;
            const grace = graceVal !== undefined && graceVal !== '' ? parseInt(graceVal, 10) : 10;

            hourlySlots.push({
                hour: i + 1,
                name: `${ordinals[i]} Hour`,
                start: start,
                end: end,
                label: `${formatTime12hr(start)} - ${formatTime12hr(end)}`,
                grace_minutes: isNaN(grace) ? 10 : grace
            });
        }

        window.FaceRecognitionState.schedules = {
            ...window.FaceRecognitionState.schedules,
            schedule_mode: mode,
            fn_start_time: fnStart,
            fn_end_time: fnEnd,
            fn_grace_minutes: fnGrace,
            an_start_time: anStart,
            an_end_time: anEnd,
            an_grace_minutes: anGrace,
            hourly_slots: hourlySlots
        };

        saveLocalState();
        updateKioskScheduleBadge();

        if (window.renderStudentFaceDashboard && typeof window.renderStudentFaceDashboard === 'function') {
            try { window.renderStudentFaceDashboard(); } catch (e) { }
        }

        const apiUrl = window.FaceRecognitionState.apiUrl;
        if (apiUrl) {
            fetch(apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: JSON.stringify({
                    action: "save_schedule_config",
                    configs: window.FaceRecognitionState.schedules
                })
            }).catch(e => console.warn(e));
        }

        // Synchronize and refresh displays
        renderSchedulesAndHolidays();

        alert("Attendance timing schedules & 7-period timings saved successfully!");
    };

    window.saveFaceSchedulesMobile = function () {
        const mode = document.getElementById('face-sched-mode-mobile')?.value || 'hourly';
        const fnStart = document.getElementById('face-sched-fn-start-mobile')?.value || '08:30';
        const fnEnd = document.getElementById('face-sched-fn-end-mobile')?.value || '12:30';
        const fnGrace = document.getElementById('face-sched-fn-grace-mobile')?.value || '15';
        const anStart = document.getElementById('face-sched-an-start-mobile')?.value || '13:30';
        const anEnd = document.getElementById('face-sched-an-end-mobile')?.value || '17:30';
        const anGrace = document.getElementById('face-sched-an-grace-mobile')?.value || '15';

        const ordinals = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th"];
        const defaultSlots = DEFAULT_SCHEDULES.hourly_slots;
        const hourlySlots = [];

        for (let i = 0; i < 7; i++) {
            const start = document.getElementById(`face-slot-start-mob-${i}`)?.value || defaultSlots[i].start;
            const end = document.getElementById(`face-slot-end-mob-${i}`)?.value || defaultSlots[i].end;
            const graceVal = document.getElementById(`face-slot-grace-mob-${i}`)?.value;
            const grace = graceVal !== undefined && graceVal !== '' ? parseInt(graceVal, 10) : 10;

            hourlySlots.push({
                hour: i + 1,
                name: `${ordinals[i]} Hour`,
                start: start,
                end: end,
                label: `${formatTime12hr(start)} - ${formatTime12hr(end)}`,
                grace_minutes: isNaN(grace) ? 10 : grace
            });
        }

        window.FaceRecognitionState.schedules = {
            ...window.FaceRecognitionState.schedules,
            schedule_mode: mode,
            fn_start_time: fnStart,
            fn_end_time: fnEnd,
            fn_grace_minutes: fnGrace,
            an_start_time: anStart,
            an_end_time: anEnd,
            an_grace_minutes: anGrace,
            hourly_slots: hourlySlots
        };

        saveLocalState();
        updateKioskScheduleBadge();

        if (window.renderStudentFaceDashboard && typeof window.renderStudentFaceDashboard === 'function') {
            try { window.renderStudentFaceDashboard(); } catch (e) { }
        }

        const apiUrl = window.FaceRecognitionState.apiUrl;
        if (apiUrl) {
            fetch(apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: JSON.stringify({
                    action: "save_schedule_config",
                    configs: window.FaceRecognitionState.schedules
                })
            }).catch(e => console.warn(e));
        }

        // Synchronize and refresh displays
        renderSchedulesAndHolidays();

        alert("Attendance timing schedules & 7-period timings saved successfully!");
    };

    window.addFaceHoliday = function () {
        const dateInput = document.getElementById('face-holiday-date');
        const titleInput = document.getElementById('face-holiday-title');
        const typeSelect = document.getElementById('face-holiday-type');

        const date = (dateInput?.value || '').trim();
        const title = (titleInput?.value || '').trim();
        const type = (typeSelect?.value || 'Full Day').trim();

        if (!date || !title) {
            alert("Please enter both holiday date and description.");
            return;
        }

        const currentUser = JSON.parse(localStorage.getItem('user')) || {};
        const adminEmail = currentUser.email || currentUser.mailid || "Admin";

        const newHol = {
            holiday_date: date,
            title: title,
            type: type,
            created_at: new Date().toISOString(),
            created_by: adminEmail
        };

        window.FaceRecognitionState.holidays.push(newHol);
        saveLocalState();
        renderSchedulesAndHolidays();
        updateKioskScheduleBadge();

        const apiUrl = window.FaceRecognitionState.apiUrl;
        if (apiUrl) {
            fetch(apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: JSON.stringify({
                    action: "save_holidays",
                    holidays: window.FaceRecognitionState.holidays
                })
            }).catch(e => console.warn(e));
        }

        if (dateInput) dateInput.value = '';
        if (titleInput) titleInput.value = '';
        alert(`Holiday scheduled for ${date}: ${title}`);
    };

    window.addFaceHolidayMobile = function () {
        const dateInput = document.getElementById('face-holiday-date-mobile');
        const titleInput = document.getElementById('face-holiday-title-mobile');
        const typeSelect = document.getElementById('face-holiday-type-mobile');

        const date = (dateInput?.value || '').trim();
        const title = (titleInput?.value || '').trim();
        const type = (typeSelect?.value || 'Full Day').trim();

        if (!date || !title) {
            alert("Please enter both holiday date and description.");
            return;
        }

        const currentUser = JSON.parse(localStorage.getItem('user')) || {};
        const adminEmail = currentUser.email || currentUser.mailid || "Admin";

        const newHol = {
            holiday_date: date,
            title: title,
            type: type,
            created_at: new Date().toISOString(),
            created_by: adminEmail
        };

        window.FaceRecognitionState.holidays.push(newHol);
        saveLocalState();
        renderSchedulesAndHolidays();
        updateKioskScheduleBadge();

        const apiUrl = window.FaceRecognitionState.apiUrl;
        if (apiUrl) {
            fetch(apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: JSON.stringify({
                    action: "save_holidays",
                    holidays: window.FaceRecognitionState.holidays
                })
            }).catch(e => console.warn(e));
        }

        if (dateInput) dateInput.value = '';
        if (titleInput) titleInput.value = '';
        alert(`Holiday scheduled for ${date}: ${title}`);
    };

    window.deleteFaceHoliday = function (dateStr) {
        if (!confirm(`Remove holiday exception for ${dateStr}?`)) return;
        window.FaceRecognitionState.holidays = window.FaceRecognitionState.holidays.filter(h => h.holiday_date !== dateStr);
        saveLocalState();
        renderSchedulesAndHolidays();
        updateKioskScheduleBadge();

        const apiUrl = window.FaceRecognitionState.apiUrl;
        if (apiUrl) {
            fetch(apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: JSON.stringify({ action: "delete_holiday", holiday_date: dateStr })
            }).catch(e => console.warn(e));
        }
    };

    window.saveFaceApiUrl = function () {
        const input = document.getElementById('face-api-url-input');
        if (!input) return;
        const val = input.value.trim();
        window.FaceRecognitionState.apiUrl = val;
        localStorage.setItem(STORAGE_KEY_API_URL, val);
        alert("Google Apps Script Web App URL updated!");
        syncWithCloud(false);
    };

    window.saveFaceApiUrlMobile = function () {
        const input = document.getElementById('face-api-url-input-mobile');
        if (!input) return;
        const val = input.value.trim();
        window.FaceRecognitionState.apiUrl = val;
        localStorage.setItem(STORAGE_KEY_API_URL, val);
        alert("Google Apps Script Web App URL updated!");
        syncWithCloud(false);
    };

    window.exportFaceAnalyticsCSV = function () {
        const logs = window.FaceRecognitionState.attendanceLogs || [];
        if (logs.length === 0) {
            alert("No attendance logs to export.");
            return;
        }

        const headers = ["Log ID", "Date", "Time", "Reg Number", "Name", "Department", "Session", "Status", "Confidence", "Admin"];
        const rows = logs.map(l => [
            l.log_id || "",
            l.date || "",
            l.time || "",
            `"${l.reg_num || ""}"`,
            `"${l.name || ""}"`,
            `"${l.department || ""}"`,
            l.session_type || "",
            l.status || "",
            l.confidence_score || "",
            l.admin_email || ""
        ]);

        const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `Face_Attendance_Logs_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    window.initFaceRecognitionModule = function () {
        loadLocalState();
        loadFaceModels();
        renderAllFaceViews();
        populateStudentSearchDropdown();

        const apiUrlInput = document.getElementById('face-api-url-input');
        if (apiUrlInput) apiUrlInput.value = window.FaceRecognitionState.apiUrl;
        const apiUrlInputMob = document.getElementById('face-api-url-input-mobile');
        if (apiUrlInputMob) apiUrlInputMob.value = window.FaceRecognitionState.apiUrl;

        window.switchFaceTab('kiosk');
    };

    // --- Admin Face Recognition Refresh & Skeleton Loading ---
    window.refreshAdminFaceRecognition = function (showSkeleton = true) {
        // Animate refresh icons
        const icons = [
            document.getElementById('admin-face-refresh-icon-mobile'),
            document.getElementById('admin-face-refresh-icon'),
            document.getElementById('face-admin-refresh-icon')
        ].filter(Boolean);

        icons.forEach(icon => {
            icon.style.transition = 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
            icon.style.transform = 'rotate(360deg)';
            setTimeout(() => { icon.style.transform = 'rotate(0deg)'; }, 500);
        });

        if (showSkeleton) {
            // 1. Kiosk Today's Affixes Skeleton
            const affixesDesktop = document.getElementById('face-kiosk-recent-logs');
            const affixesMobile = document.getElementById('face-kiosk-recent-logs-mobile');
            const skeletonAffixesHTML = `
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <div class="card no-hover-card" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: white; border-radius: 12px; border: 1.5px solid #F1F5F9;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <div class="skeleton" style="width: 28px; height: 28px; border-radius: 8px;"></div>
                            <div>
                                <div class="skeleton" style="width: 100px; height: 13px; border-radius: 4px; margin-bottom: 4px;"></div>
                                <div class="skeleton" style="width: 70px; height: 11px; border-radius: 4px;"></div>
                            </div>
                        </div>
                        <div class="skeleton" style="width: 50px; height: 18px; border-radius: 99px;"></div>
                    </div>
                    <div class="card no-hover-card" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: white; border-radius: 12px; border: 1.5px solid #F1F5F9;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <div class="skeleton" style="width: 28px; height: 28px; border-radius: 8px;"></div>
                            <div>
                                <div class="skeleton" style="width: 110px; height: 13px; border-radius: 4px; margin-bottom: 4px;"></div>
                                <div class="skeleton" style="width: 65px; height: 11px; border-radius: 4px;"></div>
                            </div>
                        </div>
                        <div class="skeleton" style="width: 50px; height: 18px; border-radius: 99px;"></div>
                    </div>
                </div>
            `;
            if (affixesDesktop) affixesDesktop.innerHTML = skeletonAffixesHTML;
            if (affixesMobile) affixesMobile.innerHTML = skeletonAffixesHTML;

            // 2. Registered Students Directory Skeleton
            const regMobile = document.getElementById('face-registered-list-grid-mobile');
            const regDesktop = document.getElementById('face-registered-list-grid');
            if (regMobile) {
                regMobile.innerHTML = `
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <div class="card no-hover-card" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: white; border-radius: 14px; border: 1.5px solid #F1F5F9;">
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <div class="skeleton" style="width: 42px; height: 42px; border-radius: 12px;"></div>
                                <div>
                                    <div class="skeleton" style="width: 110px; height: 14px; border-radius: 4px; margin-bottom: 4px;"></div>
                                    <div class="skeleton" style="width: 80px; height: 12px; border-radius: 4px;"></div>
                                </div>
                            </div>
                            <div class="skeleton" style="width: 48px; height: 24px; border-radius: 8px;"></div>
                        </div>
                        <div class="card no-hover-card" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: white; border-radius: 14px; border: 1.5px solid #F1F5F9;">
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <div class="skeleton" style="width: 42px; height: 42px; border-radius: 12px;"></div>
                                <div>
                                    <div class="skeleton" style="width: 125px; height: 14px; border-radius: 4px; margin-bottom: 4px;"></div>
                                    <div class="skeleton" style="width: 75px; height: 12px; border-radius: 4px;"></div>
                                </div>
                            </div>
                            <div class="skeleton" style="width: 48px; height: 24px; border-radius: 8px;"></div>
                        </div>
                    </div>
                `;
            }
            if (regDesktop) {
                regDesktop.innerHTML = `
                    <div style="grid-column: 1 / -1; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1rem;">
                        <div class="card no-hover-card" style="padding: 1.25rem; border-radius: 20px; border: 1.5px solid #F1F5F9; background: white;">
                            <div style="display: flex; gap: 12px; align-items: center;">
                                <div class="skeleton" style="width: 52px; height: 52px; border-radius: 14px;"></div>
                                <div style="flex: 1;">
                                    <div class="skeleton" style="width: 120px; height: 15px; border-radius: 4px; margin-bottom: 6px;"></div>
                                    <div class="skeleton" style="width: 80px; height: 13px; border-radius: 4px; margin-bottom: 4px;"></div>
                                    <div class="skeleton" style="width: 100px; height: 11px; border-radius: 4px;"></div>
                                </div>
                            </div>
                        </div>
                        <div class="card no-hover-card" style="padding: 1.25rem; border-radius: 20px; border: 1.5px solid #F1F5F9; background: white;">
                            <div style="display: flex; gap: 12px; align-items: center;">
                                <div class="skeleton" style="width: 52px; height: 52px; border-radius: 14px;"></div>
                                <div style="flex: 1;">
                                    <div class="skeleton" style="width: 120px; height: 15px; border-radius: 4px; margin-bottom: 6px;"></div>
                                    <div class="skeleton" style="width: 80px; height: 13px; border-radius: 4px; margin-bottom: 4px;"></div>
                                    <div class="skeleton" style="width: 100px; height: 11px; border-radius: 4px;"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }

            // 3. Analytics / Attendance Logs Skeleton
            const analyticsMobile = document.getElementById('face-analytics-mobile-list') || document.getElementById('face-analytics-list-mobile');
            const analyticsDesktop = document.getElementById('face-analytics-tbody');
            if (analyticsMobile) {
                analyticsMobile.innerHTML = `
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        <div class="card no-hover-card" style="background: white; border-radius: 16px; border: 1.5px solid #F1F5F9; padding: 1rem; display: flex; flex-direction: column; gap: 8px;">
                            <div style="display: flex; justify-content: space-between;">
                                <div>
                                    <div class="skeleton" style="width: 120px; height: 14px; border-radius: 4px; margin-bottom: 4px;"></div>
                                    <div class="skeleton" style="width: 80px; height: 12px; border-radius: 4px;"></div>
                                </div>
                                <div class="skeleton" style="width: 60px; height: 20px; border-radius: 99px;"></div>
                            </div>
                            <div style="display: flex; justify-content: space-between; border-top: 1px solid #F8FAFC; padding-top: 6px;">
                                <div class="skeleton" style="width: 90px; height: 14px; border-radius: 4px;"></div>
                                <div class="skeleton" style="width: 50px; height: 14px; border-radius: 4px;"></div>
                            </div>
                        </div>
                        <div class="card no-hover-card" style="background: white; border-radius: 16px; border: 1.5px solid #F1F5F9; padding: 1rem; display: flex; flex-direction: column; gap: 8px;">
                            <div style="display: flex; justify-content: space-between;">
                                <div>
                                    <div class="skeleton" style="width: 130px; height: 14px; border-radius: 4px; margin-bottom: 4px;"></div>
                                    <div class="skeleton" style="width: 75px; height: 12px; border-radius: 4px;"></div>
                                </div>
                                <div class="skeleton" style="width: 60px; height: 20px; border-radius: 99px;"></div>
                            </div>
                            <div style="display: flex; justify-content: space-between; border-top: 1px solid #F8FAFC; padding-top: 6px;">
                                <div class="skeleton" style="width: 90px; height: 14px; border-radius: 4px;"></div>
                                <div class="skeleton" style="width: 50px; height: 14px; border-radius: 4px;"></div>
                            </div>
                        </div>
                    </div>
                `;
            }
            if (analyticsDesktop) {
                analyticsDesktop.innerHTML = `
                    <tr><td colspan="7" style="padding: 1.5rem 1rem;">
                        <div class="skeleton" style="height: 28px; width: 100%; border-radius: 8px; margin-bottom: 8px;"></div>
                        <div class="skeleton" style="height: 28px; width: 100%; border-radius: 8px; margin-bottom: 8px;"></div>
                        <div class="skeleton" style="height: 28px; width: 100%; border-radius: 8px;"></div>
                    </td></tr>
                `;
            }

            // 4. Holidays Skeleton
            const holidaysMobile = document.getElementById('face-holidays-list-container-mobile');
            const holidaysDesktop = document.getElementById('face-holidays-list-container');
            const skeletonHolidaysHTML = `
                <div style="display: flex; flex-direction: column; gap: 6px;">
                    <div class="skeleton" style="height: 38px; border-radius: 10px;"></div>
                    <div class="skeleton" style="height: 38px; border-radius: 10px;"></div>
                </div>
            `;
            if (holidaysMobile) holidaysMobile.innerHTML = skeletonHolidaysHTML;
            if (holidaysDesktop) holidaysDesktop.innerHTML = skeletonHolidaysHTML;
        }

        setTimeout(() => {
            syncWithCloud(true);
            renderKioskRecentAffixes();
            renderRegisteredFacesGrid();
            renderAnalyticsTable();
            renderSchedulesAndHolidays();
        }, showSkeleton ? 350 : 0);
    };

    // --- Student Personal Face Attendance Dashboard Renderer ---
    window.refreshStudentFaceDashboard = function (showSkeleton = true) {
        const refreshIcon = document.getElementById('face-dash-refresh-icon');
        if (refreshIcon) {
            refreshIcon.style.transition = 'transform 0.5s ease';
            refreshIcon.style.transform = 'rotate(360deg)';
            setTimeout(() => { refreshIcon.style.transform = 'rotate(0deg)'; }, 500);
        }

        if (showSkeleton) {
            const mobContainer = document.getElementById('student-face-dashboard-mobile-container');
            if (mobContainer) {
                mobContainer.innerHTML = `
                    <!-- Skeleton Overview Card -->
                    <div class="card no-hover-card" style="padding: 1.15rem 1.25rem; border-radius: 20px; background: white; border: 1.5px solid #F1F5F9; margin-bottom: 0.85rem; box-shadow: 0 4px 16px rgba(0,0,0,0.02);">
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <div style="display: flex; align-items: center; gap: 12px;">
                                <div class="skeleton" style="width: 46px; height: 46px; border-radius: 14px;"></div>
                                <div>
                                    <div class="skeleton" style="width: 120px; height: 16px; border-radius: 4px; margin-bottom: 6px;"></div>
                                    <div class="skeleton" style="width: 80px; height: 12px; border-radius: 4px;"></div>
                                </div>
                            </div>
                            <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
                                <div class="skeleton" style="width: 65px; height: 26px; border-radius: 6px;"></div>
                                <div class="skeleton" style="width: 50px; height: 14px; border-radius: 99px;"></div>
                            </div>
                        </div>
                        <div style="height: 1px; background: #F8FAFC; margin: 12px 0 10px 0;"></div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;">
                            <div class="skeleton" style="height: 48px; border-radius: 10px;"></div>
                            <div class="skeleton" style="height: 48px; border-radius: 10px;"></div>
                            <div class="skeleton" style="height: 48px; border-radius: 10px;"></div>
                        </div>
                    </div>

                    <!-- Skeleton Today's Session -->
                    <div class="card no-hover-card" style="padding: 1rem 1.15rem; border-radius: 18px; background: white; border: 1.5px solid #F1F5F9; margin-bottom: 1.25rem; box-shadow: 0 4px 16px rgba(0,0,0,0.02);">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <div class="skeleton" style="width: 100px; height: 12px; border-radius: 4px;"></div>
                            <div class="skeleton" style="width: 70px; height: 12px; border-radius: 4px;"></div>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div class="skeleton" style="width: 130px; height: 16px; border-radius: 4px;"></div>
                            <div class="skeleton" style="width: 90px; height: 24px; border-radius: 99px;"></div>
                        </div>
                    </div>

                    <!-- Skeleton History Heading -->
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; padding: 0 2px;">
                        <div class="skeleton" style="width: 130px; height: 14px; border-radius: 4px;"></div>
                        <div class="skeleton" style="width: 60px; height: 18px; border-radius: 99px;"></div>
                    </div>

                    <!-- Skeleton History Cards -->
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        <div class="card no-hover-card" style="background: white; border-radius: 16px; border: 1.5px solid #F1F5F9; padding: 1rem; display: flex; flex-direction: column; gap: 10px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <div class="skeleton" style="width: 32px; height: 32px; border-radius: 10px;"></div>
                                    <div>
                                        <div class="skeleton" style="width: 110px; height: 14px; border-radius: 4px; margin-bottom: 4px;"></div>
                                        <div class="skeleton" style="width: 70px; height: 12px; border-radius: 4px;"></div>
                                    </div>
                                </div>
                                <div class="skeleton" style="width: 60px; height: 22px; border-radius: 99px;"></div>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #F8FAFC; padding-top: 8px;">
                                <div class="skeleton" style="width: 80px; height: 16px; border-radius: 6px;"></div>
                                <div class="skeleton" style="width: 65px; height: 16px; border-radius: 6px;"></div>
                            </div>
                        </div>
                        <div class="card no-hover-card" style="background: white; border-radius: 16px; border: 1.5px solid #F1F5F9; padding: 1rem; display: flex; flex-direction: column; gap: 10px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <div class="skeleton" style="width: 32px; height: 32px; border-radius: 10px;"></div>
                                    <div>
                                        <div class="skeleton" style="width: 110px; height: 14px; border-radius: 4px; margin-bottom: 4px;"></div>
                                        <div class="skeleton" style="width: 70px; height: 12px; border-radius: 4px;"></div>
                                    </div>
                                </div>
                                <div class="skeleton" style="width: 60px; height: 22px; border-radius: 99px;"></div>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #F8FAFC; padding-top: 8px;">
                                <div class="skeleton" style="width: 80px; height: 16px; border-radius: 6px;"></div>
                                <div class="skeleton" style="width: 65px; height: 16px; border-radius: 6px;"></div>
                            </div>
                        </div>
                    </div>
                `;
            }
        }

        setTimeout(() => {
            syncWithCloud(true);
            window.renderStudentFaceDashboard();
        }, showSkeleton ? 350 : 0);
    };

    // --- 7-Period Hourly Matrix Computation Engine ---
    function computeHourlyDayMatrix(personalLogs, schedules = DEFAULT_SCHEDULES) {
        const slots = (schedules.hourly_slots && schedules.hourly_slots.length === 7)
            ? schedules.hourly_slots
            : DEFAULT_SCHEDULES.hourly_slots;

        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const todayStr = `${yyyy}-${mm}-${dd}`;
        const nowMinutes = now.getHours() * 60 + now.getMinutes();

        // Collect all distinct dates from personal logs and always include today
        const dateSet = new Set();
        personalLogs.forEach(l => {
            if (l.date && l.date.match(/^\d{4}-\d{2}-\d{2}$/)) {
                dateSet.add(l.date);
            }
        });
        dateSet.add(todayStr);

        const sortedDates = Array.from(dateSet).sort((a, b) => b.localeCompare(a));

        return sortedDates.map(dateStr => {
            const isToday = (dateStr === todayStr);
            const isPast = (dateStr < todayStr);
            const isFuture = (dateStr > todayStr);

            const dayLogs = personalLogs.filter(l => l.date === dateStr);

            const hourCells = slots.map(slot => {
                const startMins = parseTimeToMinutes(slot.start);
                const endMins = parseTimeToMinutes(slot.end);
                const graceMins = parseInt(slot.grace_minutes || schedules.hourly_grace_minutes || "10", 10);
                const graceCutoffMins = startMins + graceMins;

                // Match log for this hour slot
                const matchingLog = dayLogs.find(l => {
                    const sess = (l.session_type || '').toLowerCase();
                    const slotName = (slot.name || '').toLowerCase();
                    if (sess === `hour_${slot.hour}` || sess === `hour ${slot.hour}` || sess === slotName || sess === `h${slot.hour}`) {
                        return true;
                    }
                    if (l.time) {
                        const logMins = parseTimeToMinutes(l.time);
                        if (logMins >= (startMins - 5) && logMins <= (endMins + 5)) {
                            return true;
                        }
                    }
                    return false;
                });

                if (matchingLog) {
                    const logMins = parseTimeToMinutes(matchingLog.time);
                    const isWithin10 = (logMins >= (startMins - 5) && logMins <= graceCutoffMins);
                    const isExplicitPresent = (matchingLog.status || '').toLowerCase().includes('present');

                    if (isExplicitPresent || isWithin10) {
                        return {
                            hour: slot.hour,
                            name: slot.name,
                            label: slot.label,
                            start: slot.start,
                            end: slot.end,
                            graceCutoff: minutesToTimeString(graceCutoffMins),
                            status: 'present',
                            statusLabel: 'Present',
                            time: matchingLog.time,
                            confidence: matchingLog.confidence_score || '98%'
                        };
                    } else {
                        // Logged after 10 minutes window -> Absent
                        return {
                            hour: slot.hour,
                            name: slot.name,
                            label: slot.label,
                            start: slot.start,
                            end: slot.end,
                            graceCutoff: minutesToTimeString(graceCutoffMins),
                            status: 'absent',
                            statusLabel: 'Absent (Late)',
                            time: matchingLog.time,
                            confidence: matchingLog.confidence_score || '98%'
                        };
                    }
                }

                // No log found for this hour
                if (isPast) {
                    return {
                        hour: slot.hour,
                        name: slot.name,
                        label: slot.label,
                        start: slot.start,
                        end: slot.end,
                        graceCutoff: minutesToTimeString(graceCutoffMins),
                        status: 'absent',
                        statusLabel: 'Absent',
                        time: 'Not Affixed',
                        confidence: null
                    };
                }

                if (isToday) {
                    if (nowMinutes < startMins) {
                        return {
                            hour: slot.hour,
                            name: slot.name,
                            label: slot.label,
                            start: slot.start,
                            end: slot.end,
                            graceCutoff: minutesToTimeString(graceCutoffMins),
                            status: 'upcoming',
                            statusLabel: 'Yet to start',
                            time: 'Upcoming',
                            confidence: null
                        };
                    } else if (nowMinutes <= graceCutoffMins) {
                        return {
                            hour: slot.hour,
                            name: slot.name,
                            label: slot.label,
                            start: slot.start,
                            end: slot.end,
                            graceCutoff: minutesToTimeString(graceCutoffMins),
                            status: 'active',
                            statusLabel: 'Scan Now',
                            time: `Grace till ${minutesToTimeString(graceCutoffMins)}`,
                            confidence: null
                        };
                    } else {
                        // Time has passed start + 10 mins without scan -> Absent
                        return {
                            hour: slot.hour,
                            name: slot.name,
                            label: slot.label,
                            start: slot.start,
                            end: slot.end,
                            graceCutoff: minutesToTimeString(graceCutoffMins),
                            status: 'absent',
                            statusLabel: 'Absent',
                            time: 'Missed 10m Window',
                            confidence: null
                        };
                    }
                }

                // Future date
                return {
                    hour: slot.hour,
                    name: slot.name,
                    label: slot.label,
                    start: slot.start,
                    end: slot.end,
                    graceCutoff: minutesToTimeString(graceCutoffMins),
                    status: 'upcoming',
                    statusLabel: 'Yet to start',
                    time: 'Upcoming',
                    confidence: null
                };
            });

            const presentCount = hourCells.filter(c => c.status === 'present').length;
            const absentCount = hourCells.filter(c => c.status === 'absent').length;
            const upcomingCount = hourCells.filter(c => c.status === 'upcoming' || c.status === 'active').length;
            const completedPeriods = presentCount + absentCount;
            const dayPct = completedPeriods > 0 ? Math.round((presentCount / completedPeriods) * 100) : (isToday ? 100 : 0);

            const dateObj = new Date(dateStr + 'T00:00:00');
            const dayOfWeek = isNaN(dateObj.getTime()) ? '' : dateObj.toLocaleDateString('en-US', { weekday: 'short' });
            const monthDay = isNaN(dateObj.getTime()) ? dateStr : dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const formattedDate = isToday ? `Today (${dayOfWeek}, ${monthDay})` : `${dayOfWeek}, ${monthDay}`;

            return {
                date: dateStr,
                formattedDate: formattedDate,
                dayOfWeek: dayOfWeek,
                monthDay: monthDay,
                isToday: isToday,
                hourCells: hourCells,
                presentCount: presentCount,
                absentCount: absentCount,
                upcomingCount: upcomingCount,
                completedPeriods: completedPeriods,
                dayPct: dayPct
            };
        });
    }

    // Helper for friendly 12-hour period subtitle
    function formatPeriodShortTime(time24) {
        if (!time24) return '';
        const parts = time24.split(':');
        let hrs = parseInt(parts[0], 10);
        const mins = parts[1];
        if (hrs > 12) hrs -= 12;
        if (hrs === 0) hrs = 12;
        return `${hrs}:${mins}`;
    }

    window.renderStudentFaceDashboard = function () {
        const currentUser = JSON.parse(localStorage.getItem('user')) || {};
        const regNum = (currentUser.reg_num || currentUser.roll_no || currentUser.roll_num || "7376242IT181").trim().toUpperCase();
        const email = (currentUser.email || currentUser.email_id || currentUser.mailid || "").trim().toLowerCase();
        const studentName = currentUser.name || "INDRESH S";
        const department = currentUser.department || currentUser.dept || "Information Technology";

        // Find registered face status
        const registered = window.FaceRecognitionState.registeredStudents || [];
        const studentFace = registered.find(s => 
            (s.reg_num && s.reg_num.toUpperCase() === regNum) ||
            (s.email && s.email.toLowerCase() === email)
        );
        const photoSrc = (studentFace && studentFace.photo_thumbnail) ? studentFace.photo_thumbnail : 'profile.png';

        // Filter personal logs
        const allLogs = window.FaceRecognitionState.attendanceLogs || [];
        const personalLogs = allLogs.filter(l => 
            (l.reg_num && l.reg_num.toUpperCase() === regNum) ||
            (l.name && l.name.toLowerCase() === studentName.toLowerCase())
        );

        const schedules = window.FaceRecognitionState.schedules || DEFAULT_SCHEDULES;
        const dayMatrix = computeHourlyDayMatrix(personalLogs, schedules);

        // Overall stats across all hourly periods
        let totalPossiblePeriods = 0;
        let totalPresentPeriods = 0;
        let totalAbsentPeriods = 0;

        dayMatrix.forEach(day => {
            if (day.isToday) {
                totalPossiblePeriods += (day.presentCount + day.absentCount);
            } else {
                totalPossiblePeriods += 7;
            }
            totalPresentPeriods += day.presentCount;
            totalAbsentPeriods += day.absentCount;
        });

        if (totalPossiblePeriods === 0) totalPossiblePeriods = Math.max(totalPresentPeriods, 1);
        const attendancePct = ((totalPresentPeriods / Math.max(totalPossiblePeriods, 1)) * 100).toFixed(1);

        // Standing badge calculation
        let standingBg = '#EEF2FF';
        let standingColor = '#4F46E5';
        let standingBorder = '#C7D2FE';
        let standingText = 'Active';
        if (totalPresentPeriods === 0 && totalAbsentPeriods > 0) {
            standingBg = '#FFF1F2';
            standingColor = '#E11D48';
            standingBorder = '#FECDD3';
            standingText = 'Needs Action';
        } else if (parseFloat(attendancePct) >= 75) {
            standingBg = '#ECFDF5';
            standingColor = '#059669';
            standingBorder = '#A7F3D0';
            standingText = 'Good';
        } else if (parseFloat(attendancePct) >= 50) {
            standingBg = '#FFFBEB';
            standingColor = '#B45309';
            standingBorder = '#FDE68A';
            standingText = 'Average';
        }

        // Check active session status right now
        const activeSlot = getActiveScheduleStatus();

        // --- Render Desktop View ---
        const desktopContainer = document.getElementById('student-face-dashboard-container');
        if (desktopContainer) {
            desktopContainer.innerHTML = `
                <!-- Top Overview Grid -->
                <div style="display: grid; grid-template-columns: 1.15fr 1.25fr 1.2fr; gap: 1.25rem; margin-bottom: 1.5rem;">
                    
                    <!-- 1. Student Identity Card -->
                    <div class="card no-hover-card" style="padding: 1.4rem; border-radius: 22px; background: white; border: 1.5px solid #F1F5F9; box-shadow: 0 4px 20px rgba(99, 102, 241, 0.05); display: flex; flex-direction: column; justify-content: space-between; transform: none !important;">
                        <div>
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                                <span style="font-size: 0.72rem; font-weight: 800; color: #64748B; text-transform: uppercase; letter-spacing: 0.6px;">Student Profile</span>
                                <span style="font-size: 0.7rem; font-weight: 800; background: #ECFDF5; color: #059669; padding: 2px 8px; border-radius: 99px; border: 1px solid #A7F3D0; display: inline-flex; align-items: center; gap: 4px;">
                                    ● Verified
                                </span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 14px;">
                                <div style="position: relative; flex-shrink: 0;">
                                    <img src="${photoSrc}" alt="${studentName}"
                                        style="width: 58px; height: 58px; border-radius: 16px; object-fit: cover; border: 2.5px solid #EEF2FF; box-shadow: 0 4px 14px rgba(99,102,241,0.15); display: block;"
                                        onerror="this.src='profile.png'">
                                </div>
                                <div style="flex: 1; min-width: 0;">
                                    <h4 style="font-size: 1.08rem; font-weight: 900; color: #0F172A; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: -0.2px;">${studentName}</h4>
                                    <div style="font-size: 0.8rem; font-weight: 800; color: #4F46E5; margin-top: 2px;">${regNum}</div>
                                    <div style="font-size: 0.74rem; color: #64748B; font-weight: 600; margin-top: 2px;">${department}</div>
                                </div>
                            </div>
                        </div>

                        <!-- Profile Meta Badges -->
                        <div style="margin-top: 14px; padding-top: 10px; border-top: 1px solid #F1F5F9; display: flex; align-items: center; justify-content: space-between; font-size: 0.72rem; color: #64748B;">
                            <span style="font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
                                <i data-lucide="shield-check" style="width: 14px; color: #10B981;"></i> Face Registered
                            </span>
                            <span style="font-weight: 700; color: #4F46E5; background: #EEF2FF; padding: 2px 8px; border-radius: 6px;">
                                7-Period Mode
                            </span>
                        </div>
                    </div>

                    <!-- 2. Attendance Standing & KPI Card -->
                    <div class="card no-hover-card" style="padding: 1.4rem; border-radius: 22px; background: white; border: 1.5px solid #F1F5F9; box-shadow: 0 4px 20px rgba(99, 102, 241, 0.05); display: flex; flex-direction: column; justify-content: space-between; transform: none !important;">
                        <div>
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="font-size: 0.72rem; font-weight: 800; color: #64748B; text-transform: uppercase; letter-spacing: 0.6px;">Attendance Rate</span>
                                <span style="background: ${standingBg}; color: ${standingColor}; font-size: 0.72rem; font-weight: 800; padding: 2px 9px; border-radius: 99px; border: 1px solid ${standingBorder};">${standingText}</span>
                            </div>
                            <div style="display: flex; align-items: baseline; justify-content: space-between; margin-top: 6px;">
                                <div style="display: flex; align-items: baseline; gap: 6px;">
                                    <h2 style="font-size: 2.2rem; font-weight: 900; color: ${standingColor}; margin: 0; font-family: 'Google Sans', Inter, sans-serif; letter-spacing: -1px; line-height: 1;">${attendancePct}%</h2>
                                    <span style="font-size: 0.75rem; color: #94A3B8; font-weight: 700;">(${totalPresentPeriods}/${totalPossiblePeriods} periods)</span>
                                </div>
                                <span style="font-size: 0.72rem; font-weight: 700; color: #64748B;">Target: 75%</span>
                            </div>
                        </div>

                        <!-- 3 Stat Blocks -->
                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-top: 12px;">
                            <div style="background: #F0FDF4; padding: 8px 6px; border-radius: 12px; border: 1px solid #DCFCE7; text-align: center;">
                                <div style="font-size: 0.62rem; color: #166534; font-weight: 800; text-transform: uppercase;">PRESENT</div>
                                <div style="font-size: 1.15rem; font-weight: 900; color: #059669; margin-top: 1px;">${totalPresentPeriods}</div>
                            </div>
                            <div style="background: #FFF1F2; padding: 8px 6px; border-radius: 12px; border: 1px solid #FFE4E6; text-align: center;">
                                <div style="font-size: 0.62rem; color: #BE123C; font-weight: 800; text-transform: uppercase;">ABSENT</div>
                                <div style="font-size: 1.15rem; font-weight: 900; color: #E11D48; margin-top: 1px;">${totalAbsentPeriods}</div>
                            </div>
                            <div style="background: #F8FAFC; padding: 8px 6px; border-radius: 12px; border: 1px solid #E2E8F0; text-align: center;">
                                <div style="font-size: 0.62rem; color: #475569; font-weight: 800; text-transform: uppercase;">DAYS</div>
                                <div style="font-size: 1.15rem; font-weight: 900; color: #4F46E5; margin-top: 1px;">${dayMatrix.length}</div>
                            </div>
                        </div>
                    </div>

                    <!-- 3. Current Schedule & Live Status Card -->
                    <div class="card no-hover-card" style="padding: 1.4rem; border-radius: 22px; background: white; border: 1.5px solid #F1F5F9; box-shadow: 0 4px 20px rgba(99, 102, 241, 0.05); display: flex; flex-direction: column; justify-content: space-between; transform: none !important;">
                        <div>
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                <span style="font-size: 0.72rem; font-weight: 800; color: #64748B; text-transform: uppercase; letter-spacing: 0.6px;">Live Timetable Status</span>
                                <span style="font-size: 0.7rem; font-weight: 800; color: #6366F1; background: #EEF2FF; padding: 2px 7px; border-radius: 6px;">10m Grace</span>
                            </div>
                            <div style="font-size: 1rem; font-weight: 900; color: #0F172A;">
                                ${activeSlot.isOpen ? (activeSlot.slotName || 'Current Period Active') : 'Outside Class Hours'}
                            </div>
                            <div style="font-size: 0.72rem; color: #64748B; font-weight: 600; margin-top: 2px;">
                                ${activeSlot.isOpen ? `Window: ${activeSlot.windowDesc}` : 'Regular Schedule: 8:45 AM – 4:25 PM'}
                            </div>
                        </div>

                        <!-- Schedule Status Box -->
                        <div style="margin-top: 12px;">
                            ${activeSlot.isOpen ? `
                                <div style="background: ${activeSlot.isLate ? '#FFF1F2' : '#ECFDF5'}; border: 1.5px solid ${activeSlot.isLate ? '#FECDD3' : '#A7F3D0'}; border-radius: 12px; padding: 8px 12px; display: flex; align-items: center; justify-content: space-between;">
                                    <span style="font-weight: 800; font-size: 0.82rem; color: ${activeSlot.isLate ? '#E11D48' : '#059669'};">
                                        ${activeSlot.isLate ? '⚠️ Grace Period Expired' : '🟢 Biometric Scan Open'}
                                    </span>
                                    <span style="font-size: 0.7rem; font-weight: 700; color: ${activeSlot.isLate ? '#BE123C' : '#047857'};">
                                        ${activeSlot.isLate ? 'Marked Absent' : 'Scan at Kiosk'}
                                    </span>
                                </div>
                            ` : `
                                <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 8px 12px; display: flex; align-items: center; justify-content: space-between;">
                                    <span style="font-size: 0.75rem; font-weight: 700; color: #475569; display: inline-flex; align-items: center; gap: 6px;">
                                        <i data-lucide="clock" style="width: 14px; color: #64748B;"></i> Next: 1st Hr (8:45 AM)
                                    </span>
                                    <span style="font-size: 0.7rem; font-weight: 800; color: #059669; background: #ECFDF5; padding: 1px 6px; border-radius: 4px;">
                                        Kiosk Active
                                    </span>
                                </div>
                            `}
                        </div>
                    </div>
                </div>

                <!-- 7-Period Attendance History (Desktop) -->
                <div class="card no-hover-card" style="padding: 1.5rem; border-radius: 24px; background: white; border: 1.5px solid #F1F5F9; box-shadow: var(--shadow-sm); transform: none !important;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; flex-wrap: wrap; gap: 10px;">
                        <h3 style="font-size: 1.15rem; font-weight: 900; color: #0F172A; margin: 0;">Attendance History</h3>
                        <div style="display: flex; align-items: center; gap: 14px; background: #F8FAFC; padding: 6px 14px; border-radius: 99px; border: 1px solid #E2E8F0; font-size: 0.75rem; font-weight: 700;">
                            <span style="display: inline-flex; align-items: center; gap: 5px; color: #059669;"><span style="width: 8px; height: 8px; border-radius: 50%; background: #10B981;"></span> Present</span>
                            <span style="display: inline-flex; align-items: center; gap: 5px; color: #E11D48;"><span style="width: 8px; height: 8px; border-radius: 50%; background: #EF4444;"></span> Absent</span>
                            <span style="display: inline-flex; align-items: center; gap: 5px; color: #64748B;"><span style="width: 8px; height: 8px; border-radius: 50%; background: #CBD5E1;"></span> Upcoming</span>
                        </div>
                    </div>

                    <!-- 7-Period Table -->
                    <div style="overflow-x: auto; border-radius: 16px; border: 1px solid #E2E8F0;">
                        <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.82rem;">
                            <thead>
                                <tr style="background: #F8FAFC; border-bottom: 2px solid #E2E8F0;">
                                    <th style="padding: 14px 16px; font-size: 0.72rem; font-weight: 800; color: #475569; text-transform: uppercase; width: 130px;">Date</th>
                                    <th style="padding: 12px 10px; font-size: 0.72rem; font-weight: 800; color: #475569; text-align: center;">
                                        <div style="font-weight: 900; color: #0F172A;">1st Hr</div>
                                        <div style="font-size: 0.68rem; color: #64748B; font-weight: 600; margin-top: 1px;">8:45 - 9:35 AM</div>
                                    </th>
                                    <th style="padding: 12px 10px; font-size: 0.72rem; font-weight: 800; color: #475569; text-align: center;">
                                        <div style="font-weight: 900; color: #0F172A;">2nd Hr</div>
                                        <div style="font-size: 0.68rem; color: #64748B; font-weight: 600; margin-top: 1px;">9:35 - 10:25 AM</div>
                                    </th>
                                    <th style="padding: 12px 10px; font-size: 0.72rem; font-weight: 800; color: #475569; text-align: center;">
                                        <div style="font-weight: 900; color: #0F172A;">3rd Hr</div>
                                        <div style="font-size: 0.68rem; color: #64748B; font-weight: 600; margin-top: 1px;">10:40 - 11:30 AM</div>
                                    </th>
                                    <th style="padding: 12px 10px; font-size: 0.72rem; font-weight: 800; color: #475569; text-align: center;">
                                        <div style="font-weight: 900; color: #0F172A;">4th Hr</div>
                                        <div style="font-size: 0.68rem; color: #64748B; font-weight: 600; margin-top: 1px;">11:30 - 12:25 PM</div>
                                    </th>
                                    <th style="padding: 12px 10px; font-size: 0.72rem; font-weight: 800; color: #475569; text-align: center;">
                                        <div style="font-weight: 900; color: #0F172A;">5th Hr</div>
                                        <div style="font-size: 0.68rem; color: #64748B; font-weight: 600; margin-top: 1px;">1:30 - 2:20 PM</div>
                                    </th>
                                    <th style="padding: 12px 10px; font-size: 0.72rem; font-weight: 800; color: #475569; text-align: center;">
                                        <div style="font-weight: 900; color: #0F172A;">6th Hr</div>
                                        <div style="font-size: 0.68rem; color: #64748B; font-weight: 600; margin-top: 1px;">2:20 - 3:10 PM</div>
                                    </th>
                                    <th style="padding: 12px 10px; font-size: 0.72rem; font-weight: 800; color: #475569; text-align: center;">
                                        <div style="font-weight: 900; color: #0F172A;">7th Hr</div>
                                        <div style="font-size: 0.68rem; color: #64748B; font-weight: 600; margin-top: 1px;">3:25 - 4:25 PM</div>
                                    </th>
                                    <th style="padding: 14px 16px; font-size: 0.72rem; font-weight: 800; color: #475569; text-transform: uppercase; text-align: right;">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${dayMatrix.length === 0 ? `
                                    <tr><td colspan="9" style="text-align: center; padding: 2.5rem; color: #94A3B8;">No attendance history available.</td></tr>
                                ` : dayMatrix.map(day => `
                                    <tr style="border-bottom: 1px solid #F1F5F9; background: ${day.isToday ? '#FDFEFE' : 'white'};">
                                        <td style="padding: 14px 16px; border-right: 1px solid #F1F5F9;">
                                            <div style="font-weight: 800; color: #0F172A; font-size: 0.85rem; display: flex; align-items: center; gap: 6px;">
                                                ${day.date}
                                                ${day.isToday ? '<span style="background: #EEF2FF; color: #4F46E5; font-size: 0.65rem; font-weight: 800; padding: 2px 6px; border-radius: 99px;">Today</span>' : ''}
                                            </div>
                                            <div style="font-size: 0.72rem; color: #64748B; font-weight: 600; margin-top: 2px;">${day.dayOfWeek}</div>
                                        </td>
                                        ${day.hourCells.map(cell => {
                                            if (cell.status === 'present') {
                                                return `
                                                    <td style="padding: 10px 8px; text-align: center; border-right: 1px solid #F1F5F9;">
                                                        <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                                                            <span style="background: #ECFDF5; color: #059669; padding: 3px 9px; border-radius: 99px; font-weight: 800; font-size: 0.72rem; border: 1px solid #A7F3D0; display: inline-flex; align-items: center; gap: 3px;">
                                                                ✓ Present
                                                            </span>
                                                            <span style="font-size: 0.68rem; color: #047857; font-weight: 700;">${cell.time}</span>
                                                        </div>
                                                    </td>
                                                `;
                                            } else if (cell.status === 'absent') {
                                                return `
                                                    <td style="padding: 10px 8px; text-align: center; border-right: 1px solid #F1F5F9;">
                                                        <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                                                            <span style="background: #FFF1F2; color: #E11D48; padding: 3px 9px; border-radius: 99px; font-weight: 800; font-size: 0.72rem; border: 1px solid #FECDD3; display: inline-flex; align-items: center; gap: 3px;">
                                                                ✕ Absent
                                                            </span>
                                                            <span style="font-size: 0.65rem; color: #94A3B8; font-weight: 600;">${cell.time === 'Not Affixed' || cell.time === 'Missed 10m Window' ? 'Missed' : cell.time}</span>
                                                        </div>
                                                    </td>
                                                `;
                                            } else if (cell.status === 'active') {
                                                return `
                                                    <td style="padding: 10px 8px; text-align: center; border-right: 1px solid #F1F5F9; background: #FFFBEB;">
                                                        <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                                                            <span style="background: #FEF3C7; color: #B45309; padding: 3px 9px; border-radius: 99px; font-weight: 800; font-size: 0.72rem; border: 1.5px dashed #F59E0B; display: inline-flex; align-items: center; gap: 3px;">
                                                                ⚡ Active
                                                            </span>
                                                            <span style="font-size: 0.65rem; color: #B45309; font-weight: 700;">${cell.time}</span>
                                                        </div>
                                                    </td>
                                                `;
                                            } else {
                                                // Upcoming / Yet to start
                                                return `
                                                    <td style="padding: 10px 8px; text-align: center; border-right: 1px solid #F1F5F9;">
                                                        <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                                                            <span style="background: #F8FAFC; color: #94A3B8; padding: 3px 9px; border-radius: 99px; font-weight: 700; font-size: 0.72rem; border: 1px solid #E2E8F0;">
                                                                —
                                                            </span>
                                                        </div>
                                                    </td>
                                                `;
                                            }
                                        }).join('')}
                                        <td style="padding: 14px 16px; text-align: right;">
                                            <span style="background: ${day.presentCount === 7 ? '#ECFDF5' : day.presentCount > 0 ? '#EEF2FF' : '#FFF1F2'}; color: ${day.presentCount === 7 ? '#059669' : day.presentCount > 0 ? '#4F46E5' : '#E11D48'}; border: 1px solid ${day.presentCount === 7 ? '#A7F3D0' : day.presentCount > 0 ? '#C7D2FE' : '#FECDD3'}; padding: 4px 10px; border-radius: 99px; font-weight: 800; font-size: 0.75rem;">
                                                ${day.presentCount} / 7
                                            </span>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        }

        // --- Render Mobile View (Ultra-Neat & Spacious Layout) ---
        const mobileContainer = document.getElementById('student-face-dashboard-mobile-container');
        if (mobileContainer) {
            mobileContainer.innerHTML = `
                <!-- Neat Profile & Performance Card -->
                <div class="card no-hover-card" style="padding: 1.25rem 1.15rem; border-radius: 20px; background: white; border: 1px solid #E2E8F0; box-shadow: 0 4px 18px rgba(15, 23, 42, 0.04); margin-bottom: 1.1rem; transform: none !important;">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                        <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
                            <div style="position: relative; flex-shrink: 0;">
                                <img src="${photoSrc}" alt="${studentName}"
                                    style="width: 48px; height: 48px; border-radius: 14px; object-fit: cover; border: 2px solid #EEF2FF; box-shadow: 0 4px 10px rgba(99,102,241,0.12); display: block;"
                                    onerror="this.src='profile.png'">
                                <div style="position: absolute; bottom: -2px; right: -2px; width: 12px; height: 12px; border-radius: 50%; background: #10B981; border: 2px solid white;"></div>
                            </div>
                            <div style="min-width: 0;">
                                <h3 style="font-size: 1.02rem; font-weight: 900; color: #0F172A; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: -0.2px;">${studentName}</h3>
                                <div style="font-size: 0.76rem; font-weight: 800; color: #4F46E5; margin-top: 2px;">${regNum}</div>
                            </div>
                        </div>
                        <div style="text-align: right; flex-shrink: 0;">
                            <div style="font-size: 1.65rem; font-weight: 900; color: ${standingColor}; line-height: 1; letter-spacing: -0.8px; font-family: 'Google Sans', Inter, sans-serif;">${attendancePct}%</div>
                            <span style="display: inline-block; margin-top: 3px; font-size: 0.65rem; font-weight: 800; background: ${standingBg}; color: ${standingColor}; padding: 2px 7px; border-radius: 99px; border: 1px solid ${standingBorder};">${standingText}</span>
                        </div>
                    </div>
                    
                    <div style="height: 1px; background: #F1F5F9; margin: 14px 0 12px 0;"></div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; text-align: center;">
                        <div style="background: #F0FDF4; padding: 8px 4px; border-radius: 12px; border: 1px solid #DCFCE7;">
                            <div style="font-size: 0.62rem; font-weight: 800; color: #166534; text-transform: uppercase;">PRESENT</div>
                            <div style="font-size: 1.15rem; font-weight: 900; color: #059669; margin-top: 1px;">${totalPresentPeriods}</div>
                        </div>
                        <div style="background: #FFF1F2; padding: 8px 4px; border-radius: 12px; border: 1px solid #FFE4E6;">
                            <div style="font-size: 0.62rem; color: #BE123C; font-weight: 800; text-transform: uppercase;">ABSENT</div>
                            <div style="font-size: 1.15rem; font-weight: 900; color: #E11D48; margin-top: 1px;">${totalAbsentPeriods}</div>
                        </div>
                        <div style="background: #F8FAFC; padding: 8px 4px; border-radius: 12px; border: 1px solid #E2E8F0;">
                            <div style="font-size: 0.62rem; color: #475569; font-weight: 800; text-transform: uppercase;">DAYS</div>
                            <div style="font-size: 1.15rem; font-weight: 900; color: #4F46E5; margin-top: 1px;">${dayMatrix.length}</div>
                        </div>
                    </div>
                </div>

                <!-- Section Header -->
                <div style="margin-bottom: 0.85rem; padding: 0 2px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <h4 style="font-size: 0.82rem; font-weight: 800; color: #334155; text-transform: uppercase; letter-spacing: 0.6px; margin: 0;">Daily Attendance</h4>
                        <span style="font-size: 0.72rem; font-weight: 800; color: #4F46E5; background: #EEF2FF; padding: 2px 8px; border-radius: 99px; border: 1px solid #C7D2FE;">${dayMatrix.length} Days</span>
                    </div>
                    <!-- Legend Bar -->
                    <div style="display: flex; align-items: center; justify-content: space-between; background: white; padding: 8px 12px; border-radius: 12px; border: 1px solid #E2E8F0; font-size: 0.72rem; font-weight: 800;">
                        <span style="display: inline-flex; align-items: center; gap: 5px; color: #059669;"><span style="width: 8px; height: 8px; border-radius: 50%; background: #10B981;"></span> Present</span>
                        <span style="display: inline-flex; align-items: center; gap: 5px; color: #E11D48;"><span style="width: 8px; height: 8px; border-radius: 50%; background: #EF4444;"></span> Absent</span>
                        <span style="display: inline-flex; align-items: center; gap: 5px; color: #64748B;"><span style="width: 8px; height: 8px; border-radius: 50%; background: #CBD5E1;"></span> Upcoming</span>
                    </div>
                </div>

                <!-- Single Card Per Day with 7 Hour Bubbles -->
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    ${dayMatrix.length === 0 ? `
                        <div style="background: white; border-radius: 20px; padding: 2.25rem 1.5rem; text-align: center; border: 1.5px dashed #E2E8F0;">
                            <div style="width: 44px; height: 44px; border-radius: 50%; background: #F8FAFC; color: #94A3B8; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 8px;">
                                <i data-lucide="clock" style="width: 20px;"></i>
                            </div>
                            <div style="font-weight: 800; font-size: 0.92rem; color: #1E293B;">No Attendance Records</div>
                        </div>
                    ` : dayMatrix.map(day => `
                        <div class="card no-hover-card" style="background: white; border-radius: 20px; border: 1px solid #E2E8F0; padding: 1.15rem 1.1rem; box-shadow: 0 4px 16px rgba(15, 23, 42, 0.03); transform: none !important;">
                            <!-- Top: Date Header -->
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                                <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                                    <div style="width: 36px; height: 36px; border-radius: 11px; background: linear-gradient(135deg, #EEF2FF, #E0E7FF); color: #4F46E5; display: flex; align-items: center; justify-content: center; border: 1px solid #C7D2FE; flex-shrink: 0;">
                                        <i data-lucide="calendar" style="width: 17px; height: 17px; stroke-width: 2.3px;"></i>
                                    </div>
                                    <div style="min-width: 0;">
                                        <div style="font-weight: 900; font-size: 0.92rem; color: #0F172A; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                            ${day.isToday ? 'Today' : day.dayOfWeek}, ${day.monthDay}
                                        </div>
                                        <div style="font-size: 0.72rem; color: #64748B; font-weight: 600; margin-top: 1px;">
                                            ${day.presentCount} of 7 Periods Attended
                                        </div>
                                    </div>
                                </div>
                                <div style="flex-shrink: 0;">
                                    <span style="background: ${day.presentCount === 7 ? '#ECFDF5' : day.presentCount > 0 ? '#FFFBEB' : '#FFF1F2'}; color: ${day.presentCount === 7 ? '#059669' : day.presentCount > 0 ? '#B45309' : '#E11D48'}; border: 1px solid ${day.presentCount === 7 ? '#A7F3D0' : day.presentCount > 0 ? '#FDE68A' : '#FECDD3'}; font-size: 0.72rem; font-weight: 800; padding: 3px 9px; border-radius: 99px; white-space: nowrap;">
                                        ${day.presentCount}/7
                                    </span>
                                </div>
                            </div>

                            <!-- 7-Hour Bubble Row -->
                            <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; padding: 10px 4px; background: #F8FAFC; border-radius: 16px; border: 1px solid #E2E8F0; text-align: center;">
                                ${day.hourCells.map(cell => {
                                    let bubbleBg = '#FFFFFF';
                                    let bubbleColor = '#94A3B8';
                                    let bubbleBorder = '1.5px dashed #CBD5E1';
                                    let bubbleShadow = 'none';
                                    let iconOrText = `—`;
                                    let labelColor = '#64748B';
                                    let timeSub = formatPeriodShortTime(cell.start);
                                    let timeColor = '#64748B';

                                    if (cell.status === 'present') {
                                        bubbleBg = 'linear-gradient(135deg, #10B981, #059669)';
                                        bubbleColor = '#FFFFFF';
                                        bubbleBorder = '2px solid #34D399';
                                        bubbleShadow = '0 3px 8px rgba(16, 185, 129, 0.25)';
                                        iconOrText = '✓';
                                        labelColor = '#059669';
                                        timeColor = '#059669';
                                    } else if (cell.status === 'absent') {
                                        bubbleBg = '#FFF1F2';
                                        bubbleColor = '#E11D48';
                                        bubbleBorder = '1.5px solid #FECDD3';
                                        bubbleShadow = '0 2px 4px rgba(225, 29, 72, 0.05)';
                                        iconOrText = '✕';
                                        labelColor = '#475569';
                                        timeColor = '#94A3B8';
                                    } else if (cell.status === 'active') {
                                        bubbleBg = 'linear-gradient(135deg, #FEF3C7, #FDE68A)';
                                        bubbleColor = '#B45309';
                                        bubbleBorder = '2px solid #F59E0B';
                                        bubbleShadow = '0 0 0 3px rgba(245, 158, 11, 0.2)';
                                        iconOrText = '⚡';
                                        labelColor = '#B45309';
                                        timeSub = 'Scan';
                                        timeColor = '#B45309';
                                    }

                                    return `
                                        <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                                            <span style="font-size: 0.65rem; font-weight: 800; color: ${labelColor};">H${cell.hour}</span>
                                            <div style="width: 32px; height: 32px; border-radius: 50%; background: ${bubbleBg}; color: ${bubbleColor}; border: ${bubbleBorder}; box-shadow: ${bubbleShadow}; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 0.78rem;">
                                                ${iconOrText}
                                            </div>
                                            <span style="font-size: 0.6rem; color: ${timeColor}; font-weight: 700; white-space: nowrap; margin-top: 1px;">${timeSub}</span>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        if (window.lucide) lucide.createIcons();
    };

    // Auto-bind actions
    window.captureAndAnalyzeFace = () => captureAndAnalyzeFace(false);
    window.captureAndAnalyzeFaceMobile = () => captureAndAnalyzeFace(true);
    window.saveFaceRegistration = () => saveFaceRegistration(false);
    window.saveFaceRegistrationMobile = () => saveFaceRegistration(true);
    window.deleteFaceStudent = deleteRegisteredFace;
    window.syncFaceDataWithCloud = () => syncWithCloud(false);

    // Two-way real-time background sync polling (every 25 seconds)
    setInterval(() => {
        syncWithCloud(true);
    }, 25000);

    // Sync on window focus
    window.addEventListener('focus', () => {
        syncWithCloud(true);
    });

    // Initial load
    document.addEventListener('DOMContentLoaded', () => {
        loadLocalState();
        setTimeout(() => syncWithCloud(true), 1500);
    });

})();
