const API_URL = "https://script.google.com/macros/s/AKfycbwaeDUaUeulNc7qhDFMw4mrhzywo7SO-gbwWlboc1CNmGV3oaTvQqia4SXz_k7xlSTC/exec";

// --- GLOBAL AUTH HANDLERS ---
window.handleLogout = () => { 
    localStorage.clear(); 
    window.location.replace('login.html'); 
};

window.handleCredentialResponse = async function(response) {
    const payload = JSON.parse(atob(response.credential.split('.')[1]));
    try {
        const res = await fetch(`${API_URL}?email=${encodeURIComponent(payload.email)}`);
        const data = await res.json();
        if (data.status === "success" && data.student) {
            localStorage.setItem('user', JSON.stringify(data.student));
            window.location.replace('index.html');
        } else { showToast("error", "Access Denied", "Google Account not registered in the system."); }
    } catch (e) { showToast("error", "Login Failed", "Unable to establish connection with the server."); }
};

window.handleManualLogin = async function(type) {
    const email = document.getElementById(type === 'mobile' ? 'manual-email-mobile' : 'manual-email-desktop').value.trim();
    const pass = document.getElementById(type === 'mobile' ? 'manual-password-mobile' : 'manual-password-desktop').value.trim();
    const btn = document.getElementById(type === 'mobile' ? 'btn-login-manual-mobile' : 'btn-login-manual-desktop');
    
    if (!email || !pass) return showToast("error", "Missing Details", "Please fill in all email and password fields.");
    btn.innerText = "Syncing...";
    
    try {
        const res = await fetch(`${API_URL}?email=${encodeURIComponent(email)}&rollNo=${encodeURIComponent(pass)}`);
        const data = await res.json();
        
        if (data.status === "success" && data.student) {
            localStorage.setItem('user', JSON.stringify(data.student));
            window.location.replace('index.html');
        } else {
            showToast("error", "Authentication Failed", "No Student Found! Check your credentials and try again.");
        }
    } catch (e) { showToast("error", "Connection Error", "Please check your internet connection and try again."); }
    btn.innerText = "Login to Portal";
};

window.ATTENDANCE_HISTORY = [];

// --- CORE APP LOGIC ---
document.addEventListener('DOMContentLoaded', () => {
    // 🔍 FIX: Map screen names exactly to your IDs
    const screens = {
        mob: { dash: document.getElementById('mobile-dashboard'), add: document.getElementById('mobile-add'), history: document.getElementById('mobile-history'), profile: document.getElementById('mobile-profile') },
        dsk: { dash: document.getElementById('desktop-dashboard'), history: document.getElementById('desktop-history'), profile: document.getElementById('desktop-profile') }
    };
    const navB = {
        mob: { dash: document.getElementById('nav-dash-mobile'), update: document.getElementById('nav-update-mobile'), history: document.getElementById('nav-history-mobile'), profile: document.getElementById('nav-profile-mobile') },
        dsk: { dash: document.getElementById('nav-dash-desktop'), history: document.getElementById('nav-history-desktop'), profile: document.getElementById('nav-profile-desktop') }
    };
    const actions = {
        addM: document.getElementById('btn-add-mobile'), addD: document.getElementById('btn-add-desktop'),
        mod: document.getElementById('modal-container'), close: document.getElementById('close-modal')
    };

    function show(scr) {
        const isD = window.innerWidth > 1024;
        
        // Hide all screens
        [...Object.values(screens.mob), ...Object.values(screens.dsk)].forEach(s => s?.classList.add('hidden'));
        
        // Target specifically the requested context
        const context = isD ? screens.dsk : screens.mob;
        if (context[scr]) context[scr].classList.remove('hidden');
        else if (scr === 'add' && !isD) screens.mob.add.classList.remove('hidden');

        // Toggle active states on buttons
        Object.keys(navB.mob).forEach(k => { 
            if(navB.mob[k]) {
                const isActive = (k === scr) || (k === 'update' && scr === 'add');
                navB.mob[k].classList.toggle('active', isActive); 
            }
        });
        Object.keys(navB.dsk).forEach(k => { if(navB.dsk[k]) navB.dsk[k].classList.toggle('active', k === scr); });
        
        lucide.createIcons();
    }

    Object.keys(navB.mob).forEach(k => navB.mob[k]?.addEventListener('click', () => show(k === 'update' ? 'add' : k)));
    Object.keys(navB.dsk).forEach(k => navB.dsk[k]?.addEventListener('click', () => show(k)));
    if (actions.addM) actions.addM.addEventListener('click', () => show('add'));
    if (actions.addD) actions.addD.addEventListener('click', () => { actions.mod.classList.remove('hidden'); actions.mod.style.display = 'flex'; });
    if (actions.close) actions.close.addEventListener('click', () => { actions.mod.classList.add('hidden'); actions.mod.style.display = 'none'; });

    // Enable hour selection
    document.querySelectorAll('.hour-btn').forEach(btn => {
        btn.onclick = function() { this.classList.toggle('selected'); };
    });

    populateDashboard();
    
    // 5-second Sync Polling
    setInterval(() => {
        const user = JSON.parse(localStorage.getItem('user'));
        if (user && user.email) fetchAttendance(user.email);
    }, 5000);
});

async function fetchAttendance(email) {
    if (!email) return;
    try {
        const res = await fetch(`${API_URL}?email=${encodeURIComponent(email)}&t=${Date.now()}`);
        const data = await res.json();
        if (data.status === "success" && data.history) {
            window.ATTENDANCE_HISTORY = data.history;
            renderHistory();
        }
    } catch (e) { console.warn("Sync delay"); }
}

async function populateDashboard() {
    const user = JSON.parse(localStorage.getItem('user'));
    if (!user) { if(!location.pathname.includes('login.html')) location.href = 'login.html'; return; }
    
    const fill = (id, v) => { document.querySelectorAll(`[id^="${id}"]`).forEach(el => el.innerText = v || '--'); };
    
    const name = user.indresh_s || user.name || "Student"; 
    fill('p-name', name);
    fill('p-mail', user.email);
    fill('p-reg', user.reg_num);
    fill('p-dept', user.department);
    fill('p-year', user.year);
    fill('p-mobile', user.mobile);
    fill('p-domain', user.domain);
    fill('p-mentor', user.mentor_name);

    // 🎯 Set today's date in forms (read-only)
    const todayOpts = { month: 'long', day: 'numeric', year: 'numeric' };
    const todayStr = new Date().toLocaleDateString('en-US', todayOpts);
    fill('p-date', todayStr);

    // 🎯 DIRECT NAME UPDATE: Now 100% reliable
    const firstName = name.split(' ')[0].toUpperCase();
    const gMob = document.getElementById('greeting-mob');
    const gDesk = document.getElementById('greeting-desk');
    if (gMob) gMob.innerText = `Hey ${firstName} 👋`;
    if (gDesk) gDesk.innerText = `Hey ${firstName}!`;

    // 🔍 FIX: Set Social Links (href)
    // 🔍 FIX: Set Social Links for ALL versions (Mobile, Desk, Sidebar)
    const setLink = (type, url) => {
        document.querySelectorAll(`[id*="${type}"]`).forEach(el => {
            if (el.tagName !== 'A') return; // Only target anchor tags
            let cleanUrl = (url || "").toString().trim();
            if (cleanUrl.length > 5) { 
                if (!cleanUrl.startsWith('http')) {
                    cleanUrl = 'https://' + cleanUrl;
                }
                el.href = cleanUrl;
                el.target = "_blank";
                el.style.opacity = "1";
                el.style.pointerEvents = "auto";
            } else {
                el.style.opacity = "0.3";
                el.style.pointerEvents = "none";
            }
        });
    };
    setLink('linkedin', user.linkedin);
    setLink('github', user.github);

    await fetchAttendance(user.email);
}

// 🎯 CUSTOM TOAST POPUP LOGIC (Now completely dynamic & global)
function showToast(type, title, message) {
    let overlay = document.getElementById('custom-toast-overlay');
    
    // Auto-inject HTML if it doesn't exist (e.g. on login page)
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'custom-toast-overlay';
        overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.4); backdrop-filter: blur(4px); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 1.5rem; opacity: 0; transition: opacity 0.3s ease;';
        overlay.innerHTML = `
            <div id="custom-toast-card" class="card" style="width: 100%; max-width: 380px; padding: 2.5rem 2rem; text-align: center; transform: scale(0.95); transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); display: flex; flex-direction: column; align-items: center; position: relative; border: 1px solid rgba(255,255,255,0.8); background: white; border-radius: 28px; box-shadow: 0 10px 40px rgba(0,0,0,0.1);">
                <div id="toast-icon-container" style="width: 85px; height: 85px; border-radius: 30px; display: flex; align-items: center; justify-content: center; margin-bottom: 1.5rem; box-shadow: 0 15px 35px rgba(0,0,0,0.1);">
                    <i id="toast-icon" style="width: 40px; height: 40px; color: white;"></i>
                </div>
                <h2 id="toast-title" style="font-size: 1.5rem; font-weight: 800; color: #2D3748; margin-bottom: 0.75rem;">Title</h2>
                <p id="toast-message" style="color: #718096; font-size: 0.95rem; margin-bottom: 2rem; line-height: 1.5;">Message</p>
                <button id="toast-close-btn" style="width: 100%; border-radius: 99px; height: 50px; font-weight: 700; color: white; border: none; cursor: pointer; font-family: inherit; font-size: 1rem;">Okay</button>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    const card = document.getElementById('custom-toast-card');
    const iconContainer = document.getElementById('toast-icon-container');
    const icon = document.getElementById('toast-icon');
    const titleEl = document.getElementById('toast-title');
    const msgEl = document.getElementById('toast-message');
    const btn = document.getElementById('toast-close-btn');

    overlay.style.display = 'flex';
    setTimeout(() => {
        overlay.style.opacity = '1';
        card.style.transform = 'scale(1)';
    }, 10);

    titleEl.innerText = title;
    msgEl.innerText = message;

    if (type === 'success') {
        iconContainer.style.background = 'linear-gradient(135deg, #A7F3D0 0%, #34D399 100%)';
        iconContainer.style.boxShadow = '0 15px 30px rgba(52, 211, 153, 0.25)';
        icon.setAttribute('data-lucide', 'check-circle');
        btn.style.background = 'var(--primary-gradient)';
        btn.innerText = 'Okay, thanks!';
    } else {
        iconContainer.style.background = 'linear-gradient(135deg, #FECACA 0%, #EF4444 100%)';
        iconContainer.style.boxShadow = '0 15px 30px rgba(239, 68, 68, 0.25)';
        icon.setAttribute('data-lucide', 'alert-triangle');
        btn.style.background = '#EF4444';
        btn.innerText = 'Got it';
    }

    if (window.lucide) window.lucide.createIcons();
    
    btn.onclick = () => {
        overlay.style.opacity = '0';
        card.style.transform = 'scale(0.95)';
        setTimeout(() => { overlay.style.display = 'none'; }, 300);
    };
}

// SUBMIT ATTENDANCE LOGIC
[document.getElementById('btn-submit-mobile'), document.getElementById('submit-btn-universal')].forEach(btn => {
    btn?.addEventListener('click', async () => {
        const user = JSON.parse(localStorage.getItem('user'));
        const prefix = btn.id.includes('mobile') ? 'mobile' : 'desktop';
        const task = document.getElementById(`${prefix}-task-desc`)?.value;
        const selector = btn.id.includes('mobile') ? 'hour-selector-mobile' : 'hour-selector-desktop';
        const hours = Array.from(document.querySelectorAll(`#${selector} .hour-btn.selected`)).map(h => h.dataset.hour).join(',');

        // 🎯 1. Check Deadline (Midnight strict)
        const currentHour = new Date().getHours();
        if (currentHour >= 24) {
            return showToast('error', 'Deadline Crossed', 'You cannot submit for the day after 11:59 PM. Please contact the admin with a signed letter for late entries.');
        }

        // 🎯 2. Single Submission per day check
        const todayStr = new Date().toISOString().split('T')[0];
        const hasSubmittedToday = (window.ATTENDANCE_HISTORY || []).some(h => h.date === todayStr);
        if (hasSubmittedToday) {
            return showToast('error', 'Already Submitted', 'You can submit attendance only once per day. Your attendance for today is already recorded.');
        }

        if(!task || !hours) return showToast('error', 'Missing Information', 'Please select your hours and provide a valid reason or task description.');

        btn.innerText = 'Syncing...';
        try {
            const res = await fetch(API_URL, { 
                method: 'POST', 
                body: JSON.stringify({ 
                    date: todayStr, 
                    rollNo: user.reg_num, name: (user.name || user.indresh_s), email: user.email, hours, reason: task 
                }) 
            });
            const result = await res.json();
            if(result.status === "success") {
                showToast('success', 'Attendance Recorded Successfully!', 'Soon everyone in the community will know about your work!');
                await fetchAttendance(user.email);
                document.getElementById(`${prefix}-task-desc`).value = '';
                document.querySelectorAll('.hour-btn.selected').forEach(b => b.classList.remove('selected'));
                if (prefix === 'mobile') {
                    document.getElementById('mobile-add').classList.add('hidden');
                    document.getElementById('mobile-dashboard').classList.remove('hidden');
                } else {
                    document.getElementById('modal-container').style.display = 'none';
                }
            }
        } catch (e) { showToast('error', 'Sync Queued', 'Network delay detected. It will be recorded soon.'); }
        btn.innerText = 'Submit Attendance';
    });
});

function renderHistory() {
    const dashboardList = document.getElementById('dashboard-recent-history');
    const fullHistoryList = document.getElementById('full-history-table');
    const mobileHistoryList = document.getElementById('mobile-history-list');

    // 🎯 MERGE LOGIC: Group entries by Date + Reason to show single line per day
    const entries = window.ATTENDANCE_HISTORY || [];
    const grouped = entries.reduce((acc, item) => {
        const key = item.date;
        if (!acc[key]) {
            acc[key] = { ...item, hours: item.hours.toString().split(',').map(h => h.trim()) };
        } else {
            const newHours = item.hours.toString().split(',').map(h => h.trim());
            acc[key].hours = [...new Set([...acc[key].hours, ...newHours])].sort((a,b) => a-b);
        }
        return acc;
    }, {});

    const sortedGroupedItems = Object.values(grouped).sort((a, b) => new Date(b.date) - new Date(a.date));
    const historyItems = sortedGroupedItems.slice(0, 5);

    const generateHourBubbles = (hours) => {
        return `<div style="display: flex; gap: 6px; justify-content: center;">
            ${hours.map(h => `<span style="width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; background: #f0fdfa; color: #0d9488; border-radius: 50%; font-size: 0.75rem; font-weight: 600; border: 1.5px solid #ccfbf1;">${h}</span>`).join('')}
        </div>`;
    };

    if (dashboardList) {
        dashboardList.innerHTML = historyItems.map(i => `
            <tr style="border-bottom: 1px solid #f2f4f7;">
                <td style="padding: 1.25rem; font-weight: 600; color: var(--text-primary); font-size: 0.9rem;">${i.date}</td>
                <td style="padding: 1.25rem; color: var(--text-secondary); font-size: 0.9rem;">${i.reason}</td>
                <td style="padding: 1.25rem; text-align: center;">${generateHourBubbles(i.hours)}</td>
                <td style="padding: 1.25rem; text-align: right;"><a href="#" style="color: var(--accent-teal); font-weight: 700; text-decoration: none; font-size: 0.85rem;">View</a></td>
            </tr>
        `).join('');
    }

    if (fullHistoryList) {
        fullHistoryList.innerHTML = sortedGroupedItems.map(i => `
            <tr style="border-bottom: 1px solid #f2f4f7;">
                <td style="padding: 1.25rem; font-weight: 600;">${i.date}</td>
                <td style="padding: 1.25rem;">${i.reason}</td>
                <td style="padding: 1.25rem; text-align: center;">${generateHourBubbles(i.hours)}</td>
                <td style="padding: 1.25rem; text-align: center;"><span style="background:#f0fff4; color:#276749; padding:4px 12px; border-radius:12px; font-size: 0.75rem; font-weight: 700;">Logged</span></td>
            </tr>
        `).join('');
    }

    if (mobileHistoryList) {
        mobileHistoryList.innerHTML = `
            <p style="font-weight: 700; color: var(--text-secondary); margin-bottom: 1rem; font-size: 0.8rem; letter-spacing: 1.5px;">RECENT ACTIVITY</p>
            ${historyItems.map(i => `
                <div class="card" style="padding: 1.25rem; margin-bottom: 1rem; border: 1.5px solid #f1f5f9;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <span style="font-weight: 800; color: var(--text-primary);">${i.date}</span>
                        <a href="#" style="font-size: 0.75rem; font-weight: 700; color: var(--accent-teal); text-decoration: none;">View</a>
                    </div>
                    <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 12px;">${i.reason}</p>
                    <div style="display: flex; gap: 8px;">
                        ${i.hours.map(h => `<span style="width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: #f0fdfa; color: #0d9488; border-radius: 50%; font-size: 0.8rem; font-weight: 700; border: 1.5px solid #ccfbf1;">${h}</span>`).join('')}
                    </div>
                </div>
            `).join('')}
        `;
    }

    const mobileDashboardList = document.getElementById('pending-section');
    if (mobileDashboardList) {
        mobileDashboardList.innerHTML = `
            <div class="list-section-title" style="margin-bottom: 1rem;">
                <span style="font-weight: 700;">Recent Logs</span>
            </div>
            ${historyItems.map(i => `
                <div class="card" style="padding: 1.25rem; margin-bottom: 1rem; border: 1px solid #f1f5f9; box-shadow: 0 4px 15px rgba(0,0,0,0.02);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="font-weight: 700; color: var(--text-primary); font-size: 0.95rem;">${i.date}</span>
                    </div>
                    <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 12px; line-height: 1.4;">${i.reason}</p>
                    <div style="display: flex; gap: 8px;">
                        ${i.hours.map(h => `<span style="width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; background: #f0fdfa; color: #0d9488; border-radius: 50%; font-size: 0.75rem; font-weight: 700; border: 1.5px solid #ccfbf1;">${h}</span>`).join('')}
                    </div>
                </div>
            `).join('')}
        `;
    }

    // Force hide mobile nav on desktop fallback
    const bottomNav = document.querySelector('.bottom-nav-mobile');
    if(bottomNav) bottomNav.style.display = window.innerWidth > 1024 ? 'none' : 'flex';

    let total = 0;
    const today = new Date().toISOString().split('T')[0];
    entries.filter(h => h.date === today).forEach(i => total += i.hours.toString().split(',').length);
    const stat = document.getElementById('p-today-hours'); if (stat) stat.innerText = `${total} Hours Today`;
    lucide.createIcons();

    // Force hydrate embedded Desktop Calendar instantly when history data resolves
    if (window.innerWidth > 1024) {
        renderCalendar(currentMonth, currentYear, true);
    }
}

/* --- CALENDAR LOGIC (Mobile History) --- */
let baseCurrentDate = new Date();
let currentMonth = baseCurrentDate.getMonth();
let currentYear = baseCurrentDate.getFullYear();

document.addEventListener('DOMContentLoaded', () => {
    // 🎯 Calendar DOM Listeners
    const calModal = document.getElementById('calendar-modal');
    const calCard = document.getElementById('calendar-card');
    const btnOpenCal = document.getElementById('btn-open-calendar');
    const btnCloseCal = document.getElementById('btn-close-calendar');
    
    if (btnOpenCal) {
        btnOpenCal.onclick = () => {
            if(!calModal) return;
            calModal.classList.remove('hidden');
            calModal.style.display = 'flex';
            setTimeout(() => {
                calModal.style.opacity = '1';
                calCard.style.transform = 'translateY(0)';
            }, 10);
            renderCalendar(currentMonth, currentYear, false);
        };
    }
    
    if (btnCloseCal) {
        btnCloseCal.onclick = () => {
            calCard.style.transform = 'translateY(100%)';
            calModal.style.opacity = '0';
            setTimeout(() => {
                calModal.classList.add('hidden');
                calModal.style.display = 'none';
            }, 300);
        };
    }

    // Mobile Navigation
    document.getElementById('btn-prev-month')?.addEventListener('click', () => {
        currentMonth--;
        if(currentMonth < 0) { currentMonth = 11; currentYear--; }
        renderCalendar(currentMonth, currentYear, false);
    });

    document.getElementById('btn-next-month')?.addEventListener('click', () => {
        currentMonth++;
        if(currentMonth > 11) { currentMonth = 0; currentYear++; }
        renderCalendar(currentMonth, currentYear, false);
    });

    // Desktop Navigation
    const deskCalBtn = document.getElementById('btn-open-desktop-calendar');
    const deskCalDropdown = document.getElementById('desktop-calendar-dropdown');
    
    if (deskCalBtn && deskCalDropdown) {
        deskCalBtn.onclick = (e) => {
            e.stopPropagation();
            deskCalDropdown.classList.toggle('hidden');
            if (!deskCalDropdown.classList.contains('hidden')) {
                renderCalendar(currentMonth, currentYear, true);
            }
        };
        
        document.addEventListener('click', (e) => {
            if (!deskCalBtn.contains(e.target) && !deskCalDropdown.contains(e.target)) {
                deskCalDropdown.classList.add('hidden');
            }
        });
    }

    document.getElementById('btn-prev-month-desk')?.addEventListener('click', () => {
        currentMonth--;
        if(currentMonth < 0) { currentMonth = 11; currentYear--; }
        renderCalendar(currentMonth, currentYear, true);
    });

    document.getElementById('btn-next-month-desk')?.addEventListener('click', () => {
        currentMonth++;
        if(currentMonth > 11) { currentMonth = 0; currentYear++; }
        renderCalendar(currentMonth, currentYear, true);
    });
});

function renderCalendar(month, year, isDesktop = false) {
    const prefix = isDesktop ? 'desktop-calendar' : 'calendar';
    const grid = document.getElementById(`${prefix}-grid`);
    const monthYearText = document.getElementById(`${prefix}-month-year`);
    const detailsPane = document.getElementById(`${prefix}-day-details`);
    if (!grid) return;

    detailsPane.style.display = 'none'; // hide details when changing month
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    monthYearText.innerText = `${months[month]} ${year}`;

    grid.innerHTML = '';
    
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Empty previous month cells
    for (let i = 0; i < firstDay; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'cal-day empty';
        grid.appendChild(emptyCell);
    }

    // Merge logic for quick lookups
    const entries = window.ATTENDANCE_HISTORY || [];
    const groupedData = entries.reduce((acc, item) => {
        if (!acc[item.date]) acc[item.date] = { ...item, hours: [] };
        const newHours = item.hours.toString().split(',').map(h => h.trim());
        acc[item.date].hours = [...new Set([...acc[item.date].hours, ...newHours])].sort((a,b) => a-b);
        acc[item.date].reason = item.reason;
        return acc;
    }, {});

    // Render days
    for (let i = 1; i <= daysInMonth; i++) {
        const dayCell = document.createElement('div');
        dayCell.className = 'cal-day';
        dayCell.innerText = i;

        // Build exact YYYY-MM-DD string matching dataset format
        const paddedMonth = String(month + 1).padStart(2, '0');
        const paddedDay = String(i).padStart(2, '0');
        const dateStr = `${year}-${paddedMonth}-${paddedDay}`;

        if (groupedData[dateStr]) {
            dayCell.classList.add('logged');
        }

        // Selected day style & View detail
        dayCell.onclick = () => {
            document.querySelectorAll(`#${prefix}-grid .cal-day`).forEach(el => el.classList.remove('selected'));
            dayCell.classList.add('selected');
            
            if (groupedData[dateStr]) {
                const log = groupedData[dateStr];
                const hourBubbles = log.hours.map(h => `<span style="width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: #f0fdfa; color: #0d9488; border-radius: 50%; font-size: 0.8rem; font-weight: 700; border: 1.5px solid #ccfbf1;">${h}</span>`).join('');
                document.getElementById(`${prefix}-day-content`).innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="font-weight: 800; color: var(--text-primary); font-size: 1.1rem;">${dateStr}</span>
                    </div>
                    <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 12px; line-height: 1.5;">${log.reason}</p>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">${hourBubbles}</div>
                `;
                detailsPane.style.display = 'block';
            } else {
                document.getElementById(`${prefix}-day-content`).innerHTML = `<p style="font-size: 0.85rem; color: var(--text-secondary); font-style: italic;">No attendance logged for this date.</p>`;
                detailsPane.style.display = 'block';
            }
        };

        grid.appendChild(dayCell);
    }
}
