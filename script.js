const API_URL = "https://script.google.com/macros/s/AKfycbwaeDUaUeulNc7qhDFMw4mrhzywo7SO-gbwWlboc1CNmGV3oaTvQqia4SXz_k7xlSTC/exec";
const REWARD_API_URL = "https://script.google.com/macros/s/AKfycbxP7Sm0TPV-GlLTnmFumjUxjsrQfTSFkwUc5aagplPf3cAWiMIzhaXShLEZGOxliMS4/exec";
const SYNC_API_URL = API_URL; // Using same endpoint for Worklog sync

window.WORKLOG_HISTORY = []; 


// --- HELPERS ---
const formatDate = (dateStr) => {
    if (!dateStr) return '--';
    try {
        // Robust Regex Check for YYYY-MM-DD (Universal)
        const ymdMatch = dateStr.toString().match(/^(\d{4})-(\d{2})-(\d{2})/);
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        
        if (ymdMatch) {
            const [_, y, m, d] = ymdMatch;
            return `${d.padStart(2, '0')} ${months[parseInt(m, 10) - 1]} ${y}`;
        }
        
        const dv = new Date(dateStr);
        if (isNaN(dv.getTime())) return dateStr;
        return `${String(dv.getDate()).padStart(2, '0')} ${months[dv.getMonth()]} ${dv.getFullYear()}`;
    } catch(e) { return dateStr; }
};

const showLoadingOverlay = () => {
    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.innerHTML = `
        <div style="width: 100%; height: 100%; max-width: 450px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.5rem; overflow: hidden; padding: 2rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
                <div class="skeleton" style="width: 140px; height: 30px; border-radius: 8px;"></div>
                <div class="skeleton" style="width: 50px; height: 50px; border-radius: 50%;"></div>
            </div>
            
            <div class="skeleton" style="width: 100%; height: 160px; border-radius: 24px; margin-bottom: 1rem;"></div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                <div class="skeleton" style="height: 100px; border-radius: 20px;"></div>
                <div class="skeleton" style="height: 100px; border-radius: 20px;"></div>
            </div>
            
            <div class="skeleton" style="width: 100%; height: 200px; border-radius: 20px;"></div>
            
            <div style="margin-top: 2rem; text-align: center;">
                <p style="font-weight: 800; font-size: 0.9rem; color: var(--text-secondary); letter-spacing: 0.5px; opacity: 0.7;">
                    AUTHENTICATING...
                </p>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
};

// --- GLOBAL AUTH HANDLERS ---
window.handleLogout = () => {
    localStorage.clear();
    window.location.replace('login.html?v=refreshed');
};

window.handleCredentialResponse = async function (response) {
    const payload = JSON.parse(atob(response.credential.split('.')[1]));
    try {
        const res = await fetch(`${API_URL}?email=${encodeURIComponent(payload.email)}&t=${Date.now()}`);
        const data = await res.json();
        if (data.status === "success" && data.student) {
            localStorage.setItem('user', JSON.stringify(data.student));
            showLoadingOverlay();
            window.location.replace('index.html?v=refreshed');
        } else { 
            showToast("error", "Access Denied", "Google Account not registered in the system."); 
        }
    } catch (e) { 
        showToast("error", "Login Failed", "Unable to establish connection with the server."); 
    }
};

window.handleManualLogin = async function (type) {
    const email = document.getElementById(type === 'mobile' ? 'manual-email-mobile' : 'manual-email-desktop').value.trim();
    const pass = document.getElementById(type === 'mobile' ? 'manual-password-mobile' : 'manual-password-desktop').value.trim();
    const btn = document.getElementById(type === 'mobile' ? 'btn-login-manual-mobile' : 'btn-login-manual-desktop');

    if (!email || !pass) return showToast("error", "Missing Details", "Please fill in all email and password fields.");
    btn.innerText = "Syncing...";

    try {
        const res = await fetch(`${API_URL}?email=${encodeURIComponent(email)}&rollNo=${encodeURIComponent(pass)}&t=${Date.now()}`);
        const data = await res.json();

        if (data.status === "success" && data.student) {
            localStorage.setItem('user', JSON.stringify(data.student));
            showLoadingOverlay();
            window.location.replace('index.html?v=refreshed');
        } else {
            showToast("error", "Authentication Failed", "No Student Found! Check your credentials.");
        }
    } catch (e) { 
        showToast("error", "Connection Error", "Please check your internet connection."); 
    }
    btn.innerText = "Login to Portal";
};

window.ATTENDANCE_HISTORY = [];

// --- CORE APP LOGIC ---
document.addEventListener('DOMContentLoaded', () => {
    // 🔍 FIX: Map screen names exactly to your IDs
    const screens = {
        mob: { dash: document.getElementById('mobile-dashboard'), add: document.getElementById('mobile-add'), history: document.getElementById('mobile-history'), 'work-log': document.getElementById('mobile-work-log'), profile: document.getElementById('mobile-profile') },
        dsk: { 
            dash: document.getElementById('desktop-dashboard'), 
            history: document.getElementById('desktop-history'), 
            'work-log': document.getElementById('desktop-work-log'),
            profile: document.getElementById('desktop-profile') 
        }
    };
    const navB = {
        mob: { dash: document.getElementById('nav-dash-mobile'), update: document.getElementById('nav-update-mobile'), history: document.getElementById('nav-history-mobile'), 'work-log': document.getElementById('nav-work-log-mobile'), profile: document.getElementById('nav-profile-mobile') },
        dsk: { dash: document.getElementById('nav-dash-desktop'), history: document.getElementById('nav-history-desktop'), 'work-log': document.getElementById('nav-work-log-desktop'), profile: document.getElementById('nav-profile-desktop') }
    };
    const actions = {
        addM: document.getElementById('btn-add-mobile'), addD: document.getElementById('btn-add-desktop'),
        mod: document.getElementById('modal-container'), close: document.getElementById('close-modal')
    };

    // 🛡️ SECURITY & STABILITY: Only run dashboard logic if NOT on login page
    const IS_LOGIN_PAGE = window.location.pathname.includes('login.html');
    const userLoggedIn = JSON.parse(localStorage.getItem('user'));

    // 🛡️ SECURITY: Redirect to login if not authenticated and not on login page
    if (!IS_LOGIN_PAGE && (!userLoggedIn || !userLoggedIn.email)) {
        window.location.replace('login.html?v=' + Date.now());
        return; // Stop execution
    }

    if (!IS_LOGIN_PAGE) {
        // Track current screen for back-button handling
        let currentScreen = 'dash';

        window.show = function(scr, pushHistory = true) {
            const isD = window.innerWidth > 1024;
            currentScreen = scr;

            // Hide all screens
            [...Object.values(screens.mob), ...Object.values(screens.dsk)].forEach(s => s?.classList.add('hidden'));

            // Target specifically the requested context
            const context = isD ? screens.dsk : screens.mob;
            if (context[scr]) context[scr].classList.remove('hidden');
            else if (scr === 'add' && !isD) screens.mob.add.classList.remove('hidden');

            if (scr === 'work-log') {
                if (typeof window.renderWorklogHistory === 'function') {
                    window.renderWorklogHistory();
                }
            }

            // Toggle active states on buttons
            Object.keys(navB.mob).forEach(k => {
                if (navB.mob[k]) {
                    // FIX: When adding attendance, keep the marker on the 'History/Attendance' icon
                    const isActive = (k === scr) || (k === 'history' && scr === 'add');
                    navB.mob[k].classList.toggle('active', isActive);
                }
            });
            Object.keys(navB.dsk).forEach(k => { if (navB.dsk[k]) navB.dsk[k].classList.toggle('active', k === scr); });

            // 📌 Push history state so back button stays in-app (mobile only)
            if (!isD && pushHistory) {
                history.pushState({ screen: scr }, '', '#' + scr);
            }
            
            // Ensure bottom nav is always visible when navigating
            const bottomNav = document.querySelector('.bottom-nav-mobile');
            const fab = document.getElementById('mobile-fab-container');
            if (bottomNav) bottomNav.classList.remove('bottom-nav-hidden');
            if (fab) fab.style.transform = 'translateX(-50%) translateY(0)';

            lucide.createIcons();
        }

        // 🔙 Browser Back Button Handling (Global)
        window.onpopstate = (event) => {
            // Close any open modals first
            const calModal = document.getElementById('calendar-modal');
            const calCard = document.getElementById('calendar-card');
            const attendanceModal = document.getElementById('modal-container');

            if (calModal && !calModal.classList.contains('hidden')) {
                // Close calendar with animation
                if (calCard) calCard.style.transform = 'translateY(100%)';
                calModal.style.opacity = '0';
                setTimeout(() => {
                    calModal.classList.add('hidden');
                    calModal.style.display = 'none';
                }, 300);
                return;
            }

            if (attendanceModal && !attendanceModal.classList.contains('hidden')) {
                attendanceModal.classList.add('hidden');
                return;
            }

            if (event.state && event.state.screen) {
                window.show(event.state.screen, false);
            }
        };

        // Seed initial history entry so first back press is caught
        history.replaceState({ screen: 'dash' }, '', '#dash');

        Object.keys(navB.mob).forEach(k => navB.mob[k]?.addEventListener('click', () => window.show(k === 'update' ? 'add' : k)));
        Object.keys(navB.dsk).forEach(k => navB.dsk[k]?.addEventListener('click', () => window.show(k)));
        
        // --- MOBILE NAV HIDE ON SCROLL LOGIC ---
        let lastScrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop;
        const scrollThreshold = 5; // Very sensitive
        
        window.addEventListener('scroll', () => {
            const bottomNav = document.querySelector('.bottom-nav-mobile');
            const fab = document.getElementById('mobile-fab-container');
            const currentScrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop;
            
            if (!bottomNav) return;

            const delta = currentScrollY - lastScrollY;
            
            // Ignore tiny scrolls
            if (Math.abs(delta) < scrollThreshold) return;
            
            if (delta > 0 && currentScrollY > 20) {
                // Scrolling down -> Hide
                bottomNav.classList.add('bottom-nav-hidden');
                if (fab) fab.style.transform = 'translateX(-50%) translateY(100px)';
            } else {
                // Scrolling up OR at the very top -> Show
                bottomNav.classList.remove('bottom-nav-hidden');
                if (fab) fab.style.transform = 'translateX(-50%) translateY(0)';
            }
            
            lastScrollY = Math.max(0, currentScrollY);
        }, { passive: true });

        // --- TOUCH SENSITIVITY FEEDBACK ---
        document.querySelectorAll('.btn-nav').forEach(btn => {
            btn.addEventListener('touchstart', function() {
                this.style.transition = 'transform 0.1s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
                this.style.transform = 'scale(0.85) translateY(-5px)';
            }, { passive: true });
            
            btn.addEventListener('touchend', function() {
                this.style.transition = 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
                this.style.transform = '';
            }, { passive: true });
        });

        if (actions.close) actions.close.addEventListener('click', () => { actions.mod.classList.add('hidden'); actions.mod.style.display = 'none'; });
        
        // Re-binding the desktop add button consistently
        const deskAddBtn = document.getElementById('btn-add-desktop');
        if (deskAddBtn) {
            deskAddBtn.addEventListener('click', () => {
                actions.mod.classList.remove('hidden');
                actions.mod.style.display = 'flex';
            });
        }


        // --- DASHBOARD INTERACTIVITY (Search, Filter, Profile) ---
        const mainSearch = document.querySelector('.top-bar .search-box input');
        const historySearch = document.getElementById('history-search-input');
        const filterBtn = document.querySelector('.top-bar-actions .badge-pill');
        const historyAddBtn = document.getElementById('btn-add-history-view');

        const handleSearch = (e) => {
            if (e.key === 'Enter') e.preventDefault();
            const term = e.target.value.toLowerCase();
            // SYNC both inputs for a seamless experience
            if (mainSearch) mainSearch.value = e.target.value;
            if (historySearch) historySearch.value = e.target.value;
            renderHistory(term);
        };

        if (mainSearch) {
            mainSearch.addEventListener('input', handleSearch);
            mainSearch.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
        }
        if (historySearch) {
            historySearch.addEventListener('input', handleSearch);
            historySearch.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
        }

        if (filterBtn) {
            filterBtn.addEventListener('click', () => {
                const isWeek = filterBtn.querySelector('span').innerText === 'This Week';
                filterBtn.querySelector('span').innerText = isWeek ? 'All Logs' : 'This Week';
                const term = (mainSearch?.value || historySearch?.value || '').toLowerCase();
                renderHistory(term);
            });
        }

        if (historyAddBtn) {
            historyAddBtn.addEventListener('click', () => {
                actions.mod.classList.remove('hidden');
                actions.mod.style.display = 'flex';
            });
        }

        // --- SMART FORM VALIDATION LOGIC ---
        const taskDesc = document.getElementById('desktop-task-desc');
        const submitBtn = document.getElementById('submit-btn-universal');
        const hourBtns = document.querySelectorAll('.hour-btn');

        const validateForm = () => {
             const hasHours = document.querySelectorAll('.hour-btn.selected').length > 0;
             const hasTask = taskDesc?.value.trim().length > 3; // Minimum 4 characters
             
             if (hasHours && hasTask) {
                  submitBtn.disabled = false;
                  submitBtn.style.opacity = "1";
                  submitBtn.style.cursor = "pointer";
                  submitBtn.style.background = "var(--primary-gradient)";
                  submitBtn.style.boxShadow = "0 10px 25px rgba(59, 130, 246, 0.3)";
             } else {
                  submitBtn.disabled = true;
                  submitBtn.style.opacity = "0.5";
                  submitBtn.style.cursor = "not-allowed";
                  submitBtn.style.background = "#94A3B8";
                  submitBtn.style.boxShadow = "none";
             }
        };

        if (taskDesc) taskDesc.addEventListener('input', validateForm);
        hourBtns.forEach(btn => {
             btn.onclick = function () { 
                  this.classList.toggle('selected');
                  validateForm();
             };
        });

        populateDashboard();
        // Force refresh icons for new elements
        if (typeof lucide !== 'undefined') lucide.createIcons();
        // Fetch once on load — fast (cache-backed from GAS)
        const _initUser = JSON.parse(localStorage.getItem('user'));
        if (_initUser && _initUser.email) {
            fetchAttendance(_initUser.email);
            fetchRewardPoints(_initUser.email);
        }
    } else {
        // If on login page and already have user, push to dashboard
        const _initUser = JSON.parse(localStorage.getItem('user'));
        if (_initUser && _initUser.email) {
            window.location.replace('index.html?v=session');
        }
    }
});

async function fetchAttendance(email) {
    if (!email) return;
    try {
        const user   = JSON.parse(localStorage.getItem('user'));
        const rollNo = user ? user.reg_num : '';
        const ctrl   = new AbortController();
        const timer  = setTimeout(() => ctrl.abort(), 10000);
        const res    = await fetch(
            `${API_URL}?email=${encodeURIComponent(email)}&t=${Date.now()}`,
            { signal: ctrl.signal }
        );
        clearTimeout(timer);
        const data = await res.json();
        if (data.status === "success" && data.student) {
            localStorage.setItem('user', JSON.stringify(data.student));
            if (data.history) {
                window.ATTENDANCE_HISTORY = data.history;
                renderHistory();
            }
            if (data.worklog) {
                window.WORKLOG_HISTORY = data.worklog;
                if (typeof window.renderWorklogHistory === 'function') {
                    window.renderWorklogHistory();
                }
            }
            populateDashboard(data.student);
        }
    } catch (e) { console.warn("Fetch error:", e.name); }
}

async function fetchRewardPoints(emailOrReg) {
    if (!emailOrReg) return;
    console.log("[Rewards] Fetching points for:", emailOrReg);
    try {
        const res = await fetch(`${REWARD_API_URL}?email=${encodeURIComponent(emailOrReg)}&t=${Date.now()}`);
        const data = await res.json();
        
        if (data.status === "success" && data.student) {
            const s = data.student;
            // Map values from updated GAS logic
            const earned = s.earned_points || "0";
            const used   = s.used_points   || "0";
            const balance = s.balance_points || "0";

            console.log(`[Rewards] Sync Success: E:${earned} U:${used} B:${balance}`);

            document.querySelectorAll('#p-reward-earned').forEach(el => {
                el.innerText = earned;
                el.classList.remove('skeleton-text');
            });
            document.querySelectorAll('#p-reward-used').forEach(el => {
                el.innerText = used;
                el.classList.remove('skeleton-text');
            });
            document.querySelectorAll('#p-reward-balance').forEach(el => {
                el.innerText = balance;
                el.classList.remove('skeleton-text');
                el.classList.add('animate-pulse');
                setTimeout(() => el.classList.remove('animate-pulse'), 2000);
            });
        } else {
            console.warn("[Rewards] API Response:", data.message);
        }
    } catch (e) { console.warn("Reward points fetch error:", e); }
}

async function populateDashboard(freshStudentData) {
    const user = freshStudentData || JSON.parse(localStorage.getItem('user'));
    
    // Refresh rewards using Reg Num if available, otherwise email
    if (user) {
        const searchId = user.reg_num || user.roll_num || user.roll_no || user.email;
        if (searchId) fetchRewardPoints(searchId);
    }
    
    // 🛑 STOP: If no user, only redirect if NOT already on login.html
    if (!user) { 
        const isLoginPage = window.location.pathname.includes('login.html');
        if (!isLoginPage) {
            window.location.replace('login.html?v=refreshed'); 
        }
        return; 
    }

    // 🛑 STOP: If user is logged in but stuck on login.html, push to dash
    if (window.location.pathname.includes('login.html')) {
        window.location.replace('index.html?v=dashboard');
        return;
    }

    const fill = (id, v, fallback) => { 
        const display = (v !== undefined && v !== null && v !== "") ? v : (fallback || '--');
        document.querySelectorAll(`[id^="${id}"]`).forEach(el => {
            if (el.innerText != display) el.innerText = display;
        }); 
    };

    // 👤 FILL STUDENT PROFILE DATA (Mobile & Desktop)
    const name = user.name || user.indresh_s || "Student";
    fill('p-name', name);
    fill('p-mail', user.email);
    fill('p-reg',  user.reg_num || user.roll_num || user.roll_no);
    fill('p-dept', user.department);
    fill('p-year', user.year);
    fill('p-mobile', user.mobile);
    fill('p-domain', user.domain);
    fill('p-mentor', user.mentor_name);

    const entries = window.ATTENDANCE_HISTORY || [];
    const dateMap = {}; 
    
    entries.forEach(entry => {
        const d = entry.date || entry.Date;
        const rawHours = entry.hours || entry.Hours;
        if (!d || !rawHours) return;

        if (!dateMap[d]) dateMap[d] = { morning: false, afternoon: false };
        
        const hrs = rawHours.toString().split(',').map(h => parseInt(h.trim(), 10));
        hrs.forEach(h => {
            if (h >= 1 && h <= 4) dateMap[d].morning = true;
            if (h >= 5 && h <= 7) dateMap[d].afternoon = true;
        });
    });

    let totalAbsentDays = 0;
    Object.values(dateMap).forEach(session => {
        if (session.morning) totalAbsentDays += 0.5;
        if (session.afternoon) totalAbsentDays += 0.5;
    });

    // ⏰ Today's Hours (Fixed definition)
    const todayISO = new Date().toISOString().split('T')[0];
    const todaySum = entries
        .filter(entry => entry.date === todayISO)
        .reduce((sum, entry) => {
            const hrs = entry.hours.toString().split(',').length;
            return sum + hrs;
        }, 0);
        
    // Update Dashboard Metrics IDs 
    fill('p-today-hours', todaySum + " Hours");
    fill('p-absent', totalAbsentDays);

    // 🗓️ Fill today's date in attendance forms (RE-SYNCHRONIZED)
    const todayStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const dateElMob   = document.getElementById('p-date-mobile');
    const dateElModal = document.getElementById('p-date-modal');
    if (dateElMob)   dateElMob.innerText   = todayStr;
    if (dateElModal) dateElModal.innerHTML = `<span>${todayStr}</span><i data-lucide="calendar" style="width:16px;color:var(--text-secondary);"></i>`;

    // 🎯 Greeting logic (RE-SYNCHRONIZED)
    const firstName = name.toString().split(' ')[0].toUpperCase();
    
    document.querySelectorAll('[id^="greeting-"]').forEach(el => {
        // Handle desktop 'greeting-desk' and mobile 'greeting-mob'
        const isMobile = el.id.includes('mob');
        el.innerText = `Hey ${firstName}${isMobile ? ' 👋' : '!'}`;
    });

    // 🔍 Social Links
    const setLink = (type, url) => {
        document.querySelectorAll(`[id*="${type}"]`).forEach(el => {
            if (el.tagName !== 'A') return;
            let cleanUrl = (url || "").toString().trim();
            if (cleanUrl.length > 5) {
                if (!cleanUrl.startsWith('http')) cleanUrl = 'https://' + cleanUrl;
                el.href = cleanUrl;
                el.target = "_blank";
                el.style.opacity = "1";
                el.style.pointerEvents = "auto";
            } else {
                el.href = "javascript:void(0)";
                el.style.opacity = "1";
                el.style.pointerEvents = "none";
                el.style.cursor = "default";
            }
        });
    };
    setLink('linkedin', user.linkedin);
    setLink('github', user.github);
    
    // Initialize Chart
    initAttendanceChart();
}

function initAttendanceChart() {
    const ctx = document.getElementById('attendanceChart');
    if (!ctx) return;

    // Data Processing: Get last 7 days including today
    const labels = [];
    const dataPoints = [];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const iso = d.toISOString().split('T')[0];
        labels.push(`${d.getDate()} ${months[d.getMonth()]}`);
        
        // Sum hours for this day
        const dayHours = (window.ATTENDANCE_HISTORY || [])
            .filter(h => (h.date || h.Date || '').startsWith(iso))
            .reduce((sum, h) => sum + (h.hours || h.Hours || "").toString().split(',').length, 0);
        dataPoints.push(dayHours);
    }

    if (window.myChart) window.myChart.destroy();

    window.myChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Actual Hours',
                    data: dataPoints,
                    backgroundColor: '#60A5FA', // Milky Blue
                    borderRadius: 8,
                    barThickness: 24,
                },
                {
                    label: 'Target (7h)',
                    data: labels.map(() => 7),
                    backgroundColor: 'rgba(96, 165, 250, 0.2)',
                    borderRadius: 8,
                    barThickness: 24,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { 
                legend: { 
                    display: true,
                    position: 'top',
                    align: 'end',
                    labels: {
                        usePointStyle: true,
                        pointStyle: 'circle',
                        padding: 20,
                        font: { size: 11, weight: '700', family: 'Outfit' }
                    }
                } 
            },
            scales: {
                y: { 
                    stacked: true,
                    beginAtZero: true, 
                    max: 10, 
                    grid: { color: 'rgba(0, 0, 0, 0.03)', drawBorder: false }, 
                    ticks: { font: { weight: '600' } } 
                },
                x: { 
                    stacked: true,
                    grid: { display: false },
                    ticks: { font: { weight: '600' } }
                }
            }
        }
    });
}



// 🎯 CUSTOM TOAST POPUP LOGIC (Now completely dynamic & global)
function showToast(type, title, message, callback = null) {
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
        setTimeout(() => { 
            overlay.style.display = 'none'; 
            if (callback && typeof callback === 'function') callback();
        }, 300);
    };
}

// SUBMIT ATTENDANCE LOGIC
[document.getElementById('btn-submit-mobile'), document.getElementById('submit-btn-universal')].forEach(btn => {
    btn?.addEventListener('click', async () => {
        const user = JSON.parse(localStorage.getItem('user'));
        if (!user || !user.email) {
            return showToast('error', 'Not Logged In', 'Please log in again and try submitting.');
        }

        const prefix   = btn.id.includes('mobile') ? 'mobile' : 'desktop';
        const task     = (document.getElementById(`${prefix}-task-desc`)?.value || '').trim();
        const selector = btn.id.includes('mobile') ? 'hour-selector-mobile' : 'hour-selector-desktop';
        const hours    = Array.from(document.querySelectorAll(`#${selector} .hour-btn.selected`))
                             .map(h => h.dataset.hour).join(',');

        // Today's date in IST (UTC+5:30)
        const nowIST    = new Date(Date.now() + (5.5 * 60 * 60 * 1000));
        const todayStr  = nowIST.toISOString().split('T')[0]; // YYYY-MM-DD
        const hourIST   = nowIST.getUTCHours(); // On shifted date this gives IST Hour

        // RESTRICTED SUBMISSION AFTER 11:30 PM IST
        const minutesIST = nowIST.getUTCMinutes();
        const currentTimeInMinutes = (hourIST * 60) + minutesIST;
        const deadlineInMinutes = (23 * 60) + 30; // 11:30 PM

        if (currentTimeInMinutes >= deadlineInMinutes) {
            return showToast('error', 'Deadline Missed', 'Submissions for today closed at 11:30 PM. Please contact your mentor.', () => window.show('history'));
        }

        // Already submitted check
        const hasSubmittedToday = (window.ATTENDANCE_HISTORY || []).some(h => {
            return (h.date || '').trim().split('T')[0] === todayStr;
        });
        if (hasSubmittedToday) {
            return showToast('error', 'Already Submitted', 'Attendance for today is already recorded. You can only submit once per day.', () => window.show('history'));
        }

        // Validate fields
        if (!hours) return showToast('error', 'No Hours Selected', 'Please tap on the hour buttons to select which hours you were absent.');
        if (!task)  return showToast('error', 'Reason Required', 'Please enter a reason or task description before submitting.');

        // --- OPTIMISTIC UI (Immediate Feedback) ---
        showToast('success', 'Submission Sent! 🎉', 'Your hours are being synced in the background. You can continue.', () => window.show('history'));
        
        // Immediate Form Clear & Navigation
        const descField = document.getElementById(`${prefix}-task-desc`);
        if (descField) descField.value = '';
        document.querySelectorAll('.hour-btn.selected').forEach(b => b.classList.remove('selected'));
        
        if (prefix === 'mobile') {
            window.show('history');
        } else {
            const deskMod = document.getElementById('modal-container');
            if (deskMod) { deskMod.style.display = 'none'; deskMod.classList.add('hidden'); }
        }

        // Optimistic local update to prevent double-submit and update metrics instantly
        if (!window.ATTENDANCE_HISTORY) window.ATTENDANCE_HISTORY = [];
        window.ATTENDANCE_HISTORY.push({
            date: todayStr,
            hours: hours,
            reason: task,
            status: 'Syncing...'
        });
        renderHistory(); // Update UI instantly

        // --- BACKGROUND SYNC (Non-blocking) ---
        fetch(API_URL, {
            method : 'POST',
            body   : JSON.stringify({
                date  : todayStr,
                rollNo: user.reg_num,
                name  : user.name || user.indresh_s || '',
                email : user.email,
                hours : hours,
                reason: task
            })
        }).then(res => res.json()).then(result => {
            if (result.status === 'success') {
                // Background refresh to get finalized data after a short stagger
                setTimeout(() => fetchAttendance(user.email), 2000);
            } else {
                showToast('error', 'Sync Failed', result.message || 'Background sync failed. Please check your connection.');
            }
        }).catch(err => {
            console.warn("Background fetch error:", err);
            showToast('error', 'Connection Warning', 'Submission might have failed. Please check history later.');
        });
    });
});


function renderHistory(searchTerm = '') {
    const dashboardList = document.getElementById('dashboard-recent-history');
    const fullHistoryList = document.getElementById('full-history-table');
    const mobileHistoryList = document.getElementById('mobile-history-list');
    
    const filterBtn = document.querySelector('.top-bar-actions .badge-pill span');
    const isThisWeekOnly = filterBtn && filterBtn.innerText.trim() === 'This Week';

    console.log("[DEBUG] Rendering History. Search:", searchTerm, "Filter (IsWeek):", isThisWeekOnly);

    // 🎯 MERGE LOGIC: Group entries by Date + Reason
    const entries = window.ATTENDANCE_HISTORY || [];
    console.log("[DEBUG] Total Entries fetched:", entries.length);
    const grouped = entries.reduce((acc, item) => {
        // Handle case-insensitive property names from API
        const key = item.date || item.Date;
        if (!key) return acc;
        
        // Robust property access for hours and reason
        let rawHours = item.hours || item.Hours || "";
        let hArr = [];
        if (Array.isArray(rawHours)) {
            hArr = rawHours.map(h => h.toString().trim());
        } else if (rawHours) {
            hArr = rawHours.toString().split(',').map(h => h.trim());
        }
        
        const reason = item.reason || item.Reason || "No details";

        if (!acc[key]) {
            acc[key] = { ...item, date: key, hours: hArr, reason: reason };
        } else {
            acc[key].hours = [...new Set([...acc[key].hours, ...hArr])].sort((a, b) => a - b);
        }
        return acc;
    }, {});

    const sortedGroupedItems = Object.values(grouped).sort((a, b) => new Date(b.date) - new Date(a.date));
    
    // Apply Filtering
    let filteredItems = sortedGroupedItems.filter(i => {
        const dateStr = formatDate(i.date).toLowerCase();
        const reasonStr = (i.reason || "").toLowerCase();
        const hoursStr = (i.hours || []).join(',').toLowerCase();
        
        const matchesSearch = dateStr.includes(searchTerm) || 
                             reasonStr.includes(searchTerm) || 
                             hoursStr.includes(searchTerm);
                             
        if (!isThisWeekOnly) return matchesSearch;
        
        const itemDate = new Date(i.date);
        const now = new Date();
        const dayOfWeek = now.getDay(); // 0 is Sun, 1 is Mon...
        const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Start with Monday
        const startOfWeek = new Date(now.setDate(diff));
        startOfWeek.setHours(0, 0, 0, 0);
        
        return matchesSearch && itemDate >= startOfWeek;
    });


    const historyItems = filteredItems.slice(0, 5); // Just for Dashboard Recent view

    const generateHourBubbles = (hours) => {
        return `<div style="display: flex; gap: 8px; justify-content: flex-start; align-items: center; flex-wrap: nowrap;">
            ${hours.map(h => `<span style="width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: #EFF6FF; color: #1E4ED8; border-radius: 50%; font-size: 0.8rem; font-weight: 800; border: 2px solid #BFDBFE; box-shadow: 0 2px 4px rgba(30, 78, 216, 0.05);">${h}</span>`).join('')}
        </div>`;
    };

    if (dashboardList) {
        dashboardList.innerHTML = historyItems.length > 0 ? historyItems.map(i => `
            <tr style="border-bottom: 1px solid #f2f4f7;">
                <td style="padding: 1.25rem; font-weight: 600; color: var(--text-primary); font-size: 1.15rem;">${formatDate(i.date)}</td>
                <td style="padding: 1.25rem; color: var(--text-secondary); font-size: 1.15rem;">${i.reason}</td>
                <td style="padding: 1.25rem;">${generateHourBubbles(i.hours)}</td>
            </tr>
        `).join('') : `<tr><td colspan="3" style="padding: 3rem; text-align: center; color: var(--text-secondary);">No recent activity logged.</td></tr>`;
    }

    if (fullHistoryList) {
        fullHistoryList.innerHTML = filteredItems.length > 0 ? filteredItems.map(i => `
            <tr style="border-bottom: 1px solid #f2f4f7;">
                <td style="padding: 1.25rem; font-weight: 600; font-size: 1.15rem;">${formatDate(i.date)}</td>
                <td style="padding: 1.25rem; font-size: 1.15rem;">${i.reason}</td>
                <td style="padding: 1.25rem; text-align: left;">${generateHourBubbles(i.hours)}</td>
                <td style="padding: 1.25rem; text-align: center;"><span style="background:#f0fff4; color:#276749; padding:4px 12px; border-radius:12px; font-size: 0.95rem; font-weight: 700;">Logged</span></td>
                <td style="padding: 1.25rem; text-align: center;"><input type="checkbox" class="modern-checkbox"></td>
            </tr>
        `).join('') : `<tr><td colspan="4" style="padding: 5rem; text-align: center; color: var(--text-secondary);">
                        <i data-lucide="folder-open" style="width: 48px; height: 48px; display: block; margin: 0 auto 1rem; opacity: 0.3;"></i>
                        No logs found matching your criteria.
                      </td></tr>`;
    }

    if (mobileHistoryList) {
        mobileHistoryList.innerHTML = `
            <p style="font-weight: 700; color: var(--text-secondary); margin-bottom: 1rem; font-size: 0.8rem; letter-spacing: 1.5px; text-transform: uppercase;">HISTORY (${filteredItems.length})</p>
            ${filteredItems.length > 0 ? filteredItems.map(i => `
                <div class="card" style="padding: 1rem 1rem 1rem 1.75rem; margin-bottom: 0.75rem; border: 1.5px solid #f1f5f9; border-radius: 16px !important; position: relative; overflow: hidden; transform: none !important; transition: none !important; box-shadow: 0 2px 10px rgba(0,0,0,0.02) !important;">
                    <div style="position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--primary-teal);"></div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="font-weight: 800; color: var(--text-primary); font-size: 1.15rem;">${formatDate(i.date)}</span>
                        <input type="checkbox" class="modern-checkbox">
                    </div>
                    <p style="font-size: 0.95rem; color: var(--text-secondary); margin-bottom: 10px; line-height: 1.4;">${i.reason}</p>
                    <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                        ${i.hours.map(h => `<span style="width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: #EFF6FF; color: #1E4ED8; border-radius: 50%; font-size: 0.8rem; font-weight: 800; border: 2px solid #BFDBFE; box-shadow: 0 2px 4px rgba(30, 78, 216, 0.05);">${h}</span>`).join('')}
                    </div>
                </div>
            `).join('') : `<div style="text-align: center; padding: 3rem; color: var(--text-secondary);">No logs to display.</div>`}
        `;
    }

    const mobileDashboardList = document.getElementById('pending-section');
    if (mobileDashboardList) {
        mobileDashboardList.innerHTML = `
            <div class="list-section-title" style="margin-bottom: 1rem;">
                <span style="font-weight: 700;">Recent Logs</span>
            </div>
            ${historyItems.map(i => `
                <div class="card" style="padding: 1.25rem 1.25rem 1.25rem 2rem; margin-bottom: 1rem; border: 1px solid #f1f5f9; box-shadow: 0 4px 15px rgba(0,0,0,0.02); position: relative; overflow: hidden;">
                    <div style="position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--primary-teal);"></div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="font-weight: 700; color: var(--text-primary); font-size: 0.95rem;">${formatDate(i.date)}</span>
                    </div>
                    <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 12px; line-height: 1.4;">${i.reason}</p>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        ${i.hours.map(h => `<span style="width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: #EFF6FF; color: #1E4ED8; border-radius: 50%; font-size: 0.8rem; font-weight: 800; border: 2px solid #BFDBFE; box-shadow: 0 2px 4px rgba(30, 78, 216, 0.05);">${h}</span>`).join('')}
                    </div>
                </div>
            `).join('')}
        `;
    }

    // Force hide mobile nav on desktop fallback
    const bottomNav = document.querySelector('.bottom-nav-mobile');
    if (bottomNav) bottomNav.style.display = window.innerWidth > 1024 ? 'none' : 'flex';

    let totalHrsToday = 0;
    const today = new Date().toISOString().split('T')[0];
    if (grouped[today]) {
        totalHrsToday = (grouped[today].hours || []).length;
    }
    const stat = document.getElementById('p-today-hours'); 
    if (stat) stat.innerText = `${totalHrsToday} Hours Today`;

    // 🔥 CALCULATE TOTAL LEAVE UNITS
    const totalLeaveUnits = Object.values(grouped).reduce((sum, i) => {
        const hArr = i.hours.map(h => parseInt(h));
        const morning = hArr.some(h => h >= 1 && h <= 4);
        const afternoon = hArr.some(h => h >= 5 && h <= 7);
        if (morning && afternoon) return sum + 1.0;
        if (morning || afternoon) return sum + 0.5;
        return sum;
    }, 0);

    const absentMob = document.getElementById('p-absent-mobile');
    if (absentMob) absentMob.innerText = totalLeaveUnits.toFixed(1);
    const absentDsk = document.getElementById('p-absent-desktop');
    if (absentDsk) absentDsk.innerText = totalLeaveUnits.toFixed(1);

    lucide.createIcons();

    // Force hydrate embedded Desktop Calendar instantly when history data resolves
    if (window.innerWidth > 1024) {
        renderCalendar(currentMonth, currentYear, true);
    }
}

// --- WORKLOG MODAL & LOGIC ---
window.openWorklogModal = function(editDateStr = null) {
    const modal = document.getElementById('worklog-modal-container');
    const card = document.getElementById('worklog-modal-card');
    const datePicker = document.getElementById('worklog-modal-date-picker');
    const titleEl = document.getElementById('worklog-modal-title');
    const editHidden = document.getElementById('worklog-modal-edit-date');
    
    if (editDateStr) {
        titleEl.textContent = 'Edit Work Log';
        editHidden.value = editDateStr;
        if (datePicker) datePicker.value = editDateStr;
        
        const entry = (window.WORKLOG_HISTORY || []).find(i => i.date === editDateStr);
        if (entry) {
            document.getElementById('worklog-modal-desc').value = entry.worklog || entry.description || '';
            document.getElementById('worklog-modal-title-input').value = entry.title || '';
            
            const pVal = entry.progress || 'On going';
            const colors = {'Completed':'p-completed','On going':'p-ongoing','Review Pending':'p-pending','Absent':'p-absent','OD':'p-od'};
            setProgressValue('worklog-modal-progress-value', pVal, colors[pVal] || 'p-ongoing', 'worklog-modal-progress-dropdown');
        }
    } else {
        const todayStr = new Date().toISOString().split('T')[0];
        titleEl.textContent = 'Log Work';
        editHidden.value = '';
        if (datePicker) datePicker.value = todayStr;
        document.getElementById('worklog-modal-desc').value = '';
        document.getElementById('worklog-modal-title-input').value = '';
        setProgressValue('worklog-modal-progress-value', 'On going', 'p-ongoing', 'worklog-modal-progress-dropdown');
    }

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    setTimeout(() => {
        modal.style.opacity = '1';
        card.style.transform = 'scale(1)';
    }, 10);
};

window.closeWorklogModal = function() {
    const modal = document.getElementById('worklog-modal-container');
    const card = document.getElementById('worklog-modal-card');
    if (modal) {
        modal.style.opacity = '0';
        card.style.transform = 'scale(0.95)';
        setTimeout(() => {
            modal.classList.add('hidden');
            modal.style.display = 'none';
        }, 300);
    }
};

window.toggleProgressDropdown = function(dropdownId) {
    document.querySelectorAll('.progress-dropdown').forEach(el => {
        if (el.id !== dropdownId) el.classList.remove('show');
    });
    document.getElementById(dropdownId)?.classList.toggle('show');
};

window.setProgressValue = function(displayTextId, value, pillClass, dropdownId) {
    const displayEl = document.getElementById(displayTextId);
    if (!displayEl) return;
    displayEl.className = `p-pill ${pillClass}`;
    displayEl.innerText = value;
    if (dropdownId) document.getElementById(dropdownId)?.classList.remove('show');
};

document.getElementById('btn-submit-worklog-modal')?.addEventListener('click', async () => {
    const user = JSON.parse(localStorage.getItem('user'));
    if (!user) return;
    
    const title = document.getElementById('worklog-modal-title-input')?.value.trim();
    const desc = document.getElementById('worklog-modal-desc')?.value.trim();
    const pickerDate = document.getElementById('worklog-modal-date-picker')?.value;
    const progress = document.getElementById('worklog-modal-progress-value')?.innerText.trim() || 'On going';
    const originalDate = document.getElementById('worklog-modal-edit-date')?.value;
    
    if (!title || !desc || !pickerDate) {
         return showToast('error', 'Missing Details', "Please fill in Title, Description, and Date.");
    }
    
    const btn = document.getElementById('btn-submit-worklog-modal');
    btn.innerText = "Syncing...";
    btn.style.opacity = '0.7';
    btn.style.pointerEvents = 'none';

    // If we're editing, we technically want to overwrite/update for the PICKER date
    const payloadDate = pickerDate;
    const oldDateToDelete = (originalDate && originalDate !== pickerDate) ? originalDate : null;

    try {
        const payload = {
            type    : 'worklog',
            date    : payloadDate,
            rollNo  : user.reg_num,
            title   : title,
            worklog : desc,
            progress: progress,
            oldDate : oldDateToDelete, // Backend helper if swapping dates
            batch   : user.batch || user.section || "N/A"
        };

        const res = await fetch(SYNC_API_URL, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        
        if (data.status === 'success') {
            closeWorklogModal();
            // Stagger reload
            showToast('success', 'Work Log Saved', 'Your progress has been synced successfully.');
            setTimeout(() => fetchAttendance(user.email), 1000); 
        } else {
            showToast('error', 'Sync Failed', data.message || "Failed to sync worklog.");
        }
    } catch (err) {
        showToast('error', 'Connection Error', "Your data wasn't saved. Please check your internet.");
    } finally {
        btn.innerText = "Save Work Log";
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
    }
});

// --- WORKLOG RENDERING ---
window.renderWorklogHistory = function(searchTerm = '') {
    const items = window.WORKLOG_HISTORY || [];
    
    // Safety Sort
    const sorted = [...items].sort((a,b) => {
         const dA = new Date(a.date || a.Date || 0);
         const dB = new Date(b.date || b.Date || 0);
         return dB - dA;
    });

    const filtered = sorted.filter(i => {
         const title = (i.title || '').toLowerCase();
         const log = (i.worklog || i.description || '').toLowerCase();
         const date = formatDate(i.date || i.Date).toLowerCase();
         return title.includes(searchTerm.toLowerCase()) || 
                log.includes(searchTerm.toLowerCase()) || 
                date.includes(searchTerm.toLowerCase());
    });

    // 📱 Mobile Render
    const mobEl = document.getElementById('mobile-worklog-history');
    if (mobEl) {
        if (filtered.length === 0) {
             mobEl.innerHTML = `
                <div class="card" style="padding: 4rem 2rem; text-align: center; background: white; border: 1.5px solid rgba(226, 232, 240, 0.5); border-radius: 24px !important; box-shadow: 0 4px 20px rgba(0,0,0,0.02);">
                    <div style="background: #F1F5F9; width: 64px; height: 64px; border-radius: 20px; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem; color: #94A3B8;">
                        <i data-lucide="clipboard-list" style="width: 32px; height: 32px;"></i>
                    </div>
                    <h3 style="font-size: 1.1rem; font-weight: 700; color: var(--text-primary); margin-bottom: 8px;">No logs found</h3>
                    <p style="font-size: 0.9rem; color: var(--text-secondary); line-height: 1.5;">Try adjusting your search or add a new work log entry.</p>
                </div>`;
        } else {
             mobEl.innerHTML = filtered.map(i => {
                  const pl = i.progress || 'On going';
                  const cls = {'Completed':'p-completed','On going':'p-ongoing','Review Pending':'p-pending','Absent':'p-absent','OD':'p-od'}[pl] || 'p-ongoing';
                  return `
                  <div class="card with-indicator" style="padding:1.5rem 1.5rem 1.5rem 2.4rem; border-radius:24px !important; margin-bottom:16px; border:1px solid rgba(226, 232, 240, 0.6); box-shadow: 0 8px 30px rgba(0,0,0,0.03); background: white;">
                      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                          <div style="flex: 1;">
                              <h3 style="font-size:1.35rem; font-weight:800; color:var(--text-primary); margin-bottom:4px; letter-spacing:-0.5px;">${formatDate(i.date || i.Date)}</h3>
                              <p style="font-size:0.95rem; color:#64748B; font-weight:600; margin-bottom:12px;">${i.title || 'General Work'}</p>
                              
                              <!-- Status Bubbles (Decorative / Step Indicator) -->
                              <div style="display:flex; gap:6px; margin-bottom:14px;">
                                  ${['P','W','R','C'].map(step => `<div style="width:28px; height:28px; border-radius:50%; border:1.5px solid #DBEAFE; color:#3B82F6; display:flex; align-items:center; justify-content:center; font-size:0.7rem; font-weight:800; background: ${pl.startsWith(step) ? '#DBEAFE' : 'transparent'}">${step}</div>`).join('')}
                              </div>

                              <p style="font-size:0.85rem; color:var(--text-secondary); line-height:1.6; font-weight: 500;">${(i.worklog||'').substring(0,80)}${(i.worklog||'').length>80?'...':''}</p>
                          </div>
                          <div style="display:flex; flex-direction:column; align-items:flex-end; gap:12px;">
                              <div style="width:22px; height:22px; border-radius:6px; border:2px solid #E2E8F0; opacity: 0.6;"></div>
                              <button onclick="openWorklogModal('${i.date || i.Date}')" class="btn-icon" style="background:#F1F5F9; color:var(--text-primary); border-radius:12px; width:44px; height:44px; box-shadow: 0 4px 10px rgba(0,0,0,0.02);">
                                  <i data-lucide="edit-3" style="width:18px;"></i>
                              </button>
                          </div>
                      </div>
                      <div style="margin-top:14px; padding-top:12px; border-top:1px dashed #E2E8F0; display:flex; justify-content:space-between; align-items:center;">
                          <span class="p-pill ${cls}" style="font-size:0.7rem; padding:4px 12px; border-radius:8px;">${pl}</span>
                          <span style="font-size:0.75rem; color:#94A3B8; font-weight:700;">${i.deadline ? 'UNTIL ' + formatDate(i.deadline).toUpperCase() : ''}</span>
                      </div>
                  </div>`;
             }).join('');
        }
    }

    // 💻 Desktop Render
    const deskEl = document.getElementById('desktop-worklog-history');
    if (deskEl) {
         if (filtered.length === 0) {
              deskEl.innerHTML = `<tr><td colspan="6" style="padding:4rem;text-align:center;color:var(--text-secondary);">No work logs found.</td></tr>`;
         } else {
              deskEl.innerHTML = filtered.map(i => {
                   const pl = i.progress || 'On going';
                   const cls = {'Completed':'p-completed','On going':'p-ongoing','Review Pending':'p-pending','Absent':'p-absent','OD':'p-od'}[pl] || 'p-ongoing';
                   
                   return `
                   <tr style="border-bottom:1px solid #E2E8F0;transition:background 0.2s;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='transparent'">
                        <td style="padding:1.15rem 1rem;font-weight:700;font-size:0.9rem;">${formatDate(i.date)}</td>
                        <td style="padding:1.15rem 1rem;font-weight:700;color:var(--text-primary);">${i.title || 'Work Log Phase'}</td>
                        <td style="padding:1.15rem 1rem;font-size:0.85rem;color:var(--text-secondary);max-width:320px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${i.worklog || ''}</td>
                        <td style="padding:1.15rem 1rem;text-align:center;font-weight:600;font-size:0.85rem;">${i.deadline ? formatDate(i.deadline) : '--'}</td>
                        <td style="padding:1.15rem 1rem;text-align:center;"><span class="p-pill ${cls}">${pl}</span></td>
                        <td style="padding:1.15rem 1rem;text-align:center;">
                             <button onclick="openWorklogModal('${i.date}')" class="btn-icon" style="background:#EFF6FF;color:#2563EB;border-radius:10px;"><i data-lucide="edit-3" style="width:16px;"></i></button>
                        </td>
                   </tr>`;
              }).join('');
         }
         if (window.lucide) lucide.createIcons();
    }
};

// Search Setup for Worklog
['worklog-search-input-mobile', 'worklog-search-input'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', (e) => {
        if (typeof window.renderWorklogHistory === 'function') {
            window.renderWorklogHistory(e.target.value);
        }
    });
});

// --- WORKLOG CALENDAR logic ---
let wlCurrentMonth = new Date().getMonth();
let wlCurrentYear  = new Date().getFullYear();

function initWorklogCalendar() {
    const wlModal = document.getElementById('worklog-calendar-modal');
    const wlCard  = document.getElementById('worklog-calendar-card');
    
    document.getElementById('btn-open-worklog-calendar')?.addEventListener('click', () => {
        wlModal.classList.remove('hidden');
        wlModal.style.display = 'flex';
        setTimeout(() => {
            wlModal.style.opacity = '1';
            wlCard.style.transform = 'translateY(0)';
        }, 10);
        renderWorklogCalendar(wlCurrentMonth, wlCurrentYear);

        if (window.innerWidth <= 1024) {
            history.pushState({ modal: 'worklog-calendar' }, '', '#worklog-calendar');
        }
    });

    document.getElementById('btn-close-worklog-calendar')?.addEventListener('click', () => {
        wlCard.style.transform = 'translateY(100%)';
        wlModal.style.opacity = '0';
        setTimeout(() => { wlModal.classList.add('hidden'); wlModal.style.display = 'none'; }, 300);
    });
    
    document.getElementById('wl-btn-prev-month')?.addEventListener('click', () => {
        wlCurrentMonth--;
        if (wlCurrentMonth < 0) { wlCurrentMonth = 11; wlCurrentYear--; }
        renderWorklogCalendar(wlCurrentMonth, wlCurrentYear);
    });

    document.getElementById('wl-btn-next-month')?.addEventListener('click', () => {
        wlCurrentMonth++;
        if (wlCurrentMonth > 11) { wlCurrentMonth = 0; wlCurrentYear++; }
        renderWorklogCalendar(wlCurrentMonth, wlCurrentYear);
    });
}

function renderWorklogCalendar(month, year) {
    const grid = document.getElementById('worklog-calendar-grid');
    if (!grid) return;
    
    const monthLabel = document.getElementById('worklog-calendar-month-year');
    const detailPane = document.getElementById('worklog-calendar-day-details');
    detailPane.style.display = 'none';
    
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    monthLabel.innerText = `${months[month]} ${year}`;
    grid.innerHTML = '';

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const groupedData = (window.WORKLOG_HISTORY || []).reduce((acc, item) => {
        const dateKey = item.date || '';
        if (!acc[dateKey]) acc[dateKey] = [];
        acc[dateKey].push(item);
        return acc;
    }, {});

    for (let i = 0; i < firstDay; i++) {
        const empty = document.createElement('div');
        empty.className = 'cal-day empty';
        grid.appendChild(empty);
    }

    const todayStr = new Date().toISOString().split('T')[0];

    for (let i = 1; i <= daysInMonth; i++) {
        const dayCell = document.createElement('div');
        dayCell.className = 'cal-day';
        dayCell.innerText = i;

        const paddedMonth = String(month + 1).padStart(2, '0');
        const paddedDay   = String(i).padStart(2, '0');
        const dateStr     = `${year}-${paddedMonth}-${paddedDay}`;

        if (groupedData[dateStr]) {
            dayCell.classList.add('logged');
        }

        if (dateStr === todayStr) dayCell.classList.add('today');

        dayCell.onclick = () => {
            document.querySelectorAll('#worklog-calendar-grid .cal-day').forEach(el => el.classList.remove('selected'));
            dayCell.classList.add('selected');

            const dayLogs = groupedData[dateStr];
            const contentEl = document.getElementById('worklog-calendar-day-content');

            if (dayLogs && dayLogs.length > 0) {
                contentEl.innerHTML = dayLogs.map(log => {
                    const progressColor = log.progress === 'Completed' ? '#059669' : log.progress === 'Review Pending' ? '#D97706' : '#3B82F6';
                    return `
                    <div style="padding: 0.75rem 0; border-bottom: 1px dashed #E2E8F0;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                            <span style="font-weight:800; color:var(--text-primary); font-size:1rem;">${log.title || 'Work Log'}</span>
                            <span style="font-size:0.65rem; font-weight:700; color:${progressColor}; background:${progressColor}18; padding:4px 10px; border-radius:99px;">${log.progress || 'On going'}</span>
                        </div>
                        <p style="font-size:0.85rem; color:var(--text-secondary); line-height:1.5;">${log.worklog || ''}</p>
                    </div>`;
                }).join('');
            } else {
                contentEl.innerHTML = `<p style="font-size:0.85rem; color:var(--text-secondary); font-style:italic; text-align:center;">No work logged for this date.</p>`;
            }
            detailPane.style.display = 'block';
        };

        grid.appendChild(dayCell);
    }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', initWorklogCalendar);


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
            if (!calModal) return;
            calModal.classList.remove('hidden');
            calModal.style.display = 'flex';
            setTimeout(() => {
                calModal.style.opacity = '1';
                calCard.style.transform = 'translateY(0)';
            }, 10);
            
            // Push state for back-button closure
            if (window.innerWidth <= 1024) {
                history.pushState({ modal: 'calendar' }, '', '#calendar');
            }
            
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
        if (currentMonth < 0) { currentMonth = 11; currentYear--; }
        renderCalendar(currentMonth, currentYear, false);
    });

    document.getElementById('btn-next-month')?.addEventListener('click', () => {
        currentMonth++;
        if (currentMonth > 11) { currentMonth = 0; currentYear++; }
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
        if (currentMonth < 0) { currentMonth = 11; currentYear--; }
        renderCalendar(currentMonth, currentYear, true);
    });

    document.getElementById('btn-next-month-desk')?.addEventListener('click', () => {
        currentMonth++;
        if (currentMonth > 11) { currentMonth = 0; currentYear++; }
        renderCalendar(currentMonth, currentYear, true);
    });

    // --- REAL-TIME FORM VALIDATION ---
    const updateSubmitButtonState = () => {
        const hours = document.querySelectorAll('#hour-selector-mobile .hour-btn.selected').length;
        const task = document.getElementById('mobile-task-desc').value.trim();
        const btn = document.getElementById('btn-submit-mobile');
        
        if (btn) {
            const isValid = hours > 0 && task.length > 5;
            btn.disabled = !isValid;
            btn.style.opacity = isValid ? '1' : '0.4';
            btn.style.filter = isValid ? 'none' : 'grayscale(0.5)';
            btn.style.pointerEvents = isValid ? 'auto' : 'none';
        }
    };

    document.getElementById('mobile-task-desc')?.addEventListener('input', updateSubmitButtonState);
    document.querySelectorAll('#hour-selector-mobile .hour-btn').forEach(b => b.addEventListener('click', () => setTimeout(updateSubmitButtonState, 10)));
    
    // Initial state
    updateSubmitButtonState();
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
        acc[item.date].hours = [...new Set([...acc[item.date].hours, ...newHours])].sort((a, b) => a - b);
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

        // Highlight Today
        const isToday = dateStr === new Date().toISOString().split('T')[0];
        if (isToday) {
            dayCell.style.border = '2px solid var(--primary-teal)';
            dayCell.style.fontWeight = '900';
            dayCell.style.color = 'var(--primary-teal)';
        }

        // Selected day style & View detail
        dayCell.onclick = () => {
            document.querySelectorAll(`#${prefix}-grid .cal-day`).forEach(el => el.classList.remove('selected'));
            dayCell.classList.add('selected');

            if (groupedData[dateStr]) {
                const log = groupedData[dateStr];
                const hourBubbles = log.hours.map(h => `<span style="width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: #EFF6FF; color: #2563EB; border-radius: 50%; font-size: 0.8rem; font-weight: 700; border: 1.5px solid rgba(59, 130, 246, 0.2);">${h}</span>`).join('');
                document.getElementById(`${prefix}-day-content`).innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="font-weight: 800; color: var(--text-primary); font-size: 1.1rem;">${formatDate(dateStr)}</span>
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

// --- UNIVERSAL LOG TRIGGER (Central FAB) ---
window.openUniversalLog = function() {
    openWorklogModal();
};

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
    const selector = e.target.closest('.progress-selector');
    if (!selector) {
        document.querySelectorAll('.progress-dropdown').forEach(el => el.classList.remove('show'));
    }
});

document.getElementById('btn-add-worklog-mobile')?.addEventListener('click', () => openWorklogModal());
