document.addEventListener('DOMContentLoaded', () => {
    const API_URL = 'http://localhost:5000';
    console.log('Using API_URL =', API_URL);

    const loginFormEl = document.getElementById('login-form');
    const signupFormEl = document.getElementById('signup-form');
    const otpFormEl = document.getElementById('otp-form');
    const signupForm = document.getElementById('signup-form-element');
    const loginForm = document.getElementById('login-form-element');
    const otpForm = document.getElementById('otp-form-element');
    const showSignupLink = document.getElementById('show-signup');
    const showLoginLink = document.getElementById('show-login');
    const otpSubtitle = document.getElementById('otp-subtitle');

    let userEmailForOtp = '';

    // Server Health Check
    async function checkServer() {
        try {
            const resp = await fetch(`${API_URL}/ping`, { method: 'GET' });
            if (!resp.ok) {
                console.error('Ping failed', resp.status, await resp.text());
                return false;
            }
            const j = await resp.json();
            console.log('Backend ping response:', j);
            return true;
        } catch (err) {
            console.error('Ping error:', err);
            return false;
        }
    }

    // Form Display Management
    function showForm(formToShow) {
        const allForms = [loginFormEl, signupFormEl, otpFormEl];
        const isMobile = window.innerWidth <= 800;

        allForms.forEach(form => {
            const isActive = form === formToShow;
            const baseClass = form.id.replace('-form', '');
            if (isMobile) {
                form.style.display = isActive ? 'block' : 'none';
            } else {
                form.className = `form-wrapper ${baseClass}-${isActive ? 'active' : 'inactive'}`;
            }
        });
    }

    showSignupLink.addEventListener('click', (e) => { 
        e.preventDefault(); 
        showForm(signupFormEl); 
    });
    
    showLoginLink.addEventListener('click', (e) => { 
        e.preventDefault(); 
        showForm(loginFormEl); 
    });

    // Sign Up Form Handler
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(signupForm);
        const data = Object.fromEntries(formData.entries());
        if (!data.username && data.name) data.username = data.name;
        userEmailForOtp = data.email;

        const up = await checkServer();
        if (!up) {
            alert('Backend server not reachable at ' + API_URL + '\nPlease start the backend: run `npm start` in the Backend folder');
            return;
        }

        try {
            const response = await fetch(`${API_URL}/auth/register`, { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const resultText = await response.text();
            let result = {};
            try { 
                result = JSON.parse(resultText); 
            } catch (e) { 
                result = { message: resultText }; 
            }
            
            if (!response.ok) {
                console.error('Register failed', response.status, result);
                alert(`Error: ${result.message || 'Registration failed'}`);
                return;
            }
            
            console.log('Register response', result);
            alert(result.message + (result.previewUrl ? `\n(Email preview: ${result.previewUrl})` : ''));
            otpSubtitle.textContent = `We've sent a verification code to ${userEmailForOtp}.`;
            otpForm.dataset.purpose = 'register';
            showForm(otpFormEl);
        } catch (error) {
            console.error('Network/register error:', error);
            alert('Could not connect to the server. See console for details.');
        }
    });

    // OTP Verification Handler
    otpForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const otp = document.getElementById('otp-code').value;
        const purpose = otpForm.dataset.purpose || 'register';
        
        try {
            const response = await fetch(`${API_URL}/auth/verify-otp`, { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: userEmailForOtp, otp: otp, purpose }),
            });
            const result = await response.json();
            
            if (!response.ok) {
                alert(`Error: ${result.message}`);
                return;
            }
            
            // On successful verification we receive token & user
            if (result.token) {
                localStorage.setItem('authToken', result.token);
                localStorage.setItem('userName', result.user?.username || '');
                alert('Verification successful — Redirecting to dashboard');
                window.location.href = 'dashboard.html';
                return;
            }
            
            alert(result.message || 'Verified');
            showForm(loginFormEl);
        } catch (error) {
            alert('Could not connect to the server.');
        }
    });

    // Login Form Handler
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(loginForm);
        const data = Object.fromEntries(formData.entries());
        userEmailForOtp = data.email;
        
        try {
            const response = await fetch(`${API_URL}/auth/login`, { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const result = await response.json();
            
            if (!response.ok) {
                alert(`Error: ${result.message}`);
                return;
            }
            
            alert(result.message + (result.previewUrl ? `\n(Email preview: ${result.previewUrl})` : ''));
            otpSubtitle.textContent = `We've sent a login OTP to ${userEmailForOtp}.`;
            otpForm.dataset.purpose = 'login';
            showForm(otpFormEl);
        } catch (error) {
            alert('Could not connect to the server.');
        }
    });

    // Initialize with login form
    showForm(loginFormEl);
});