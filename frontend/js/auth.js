
// ========================================
// SMART FARMER AUTHENTICATION SYSTEM
// ========================================

const API_URL = "/api/auth";


// ========================================
// COMMON MESSAGE FUNCTION
// ========================================

function showMessage(element, message, type = "error") {
    if (!element) return;

    element.textContent = localizedText(message);
    element.className = `message ${type}`;
}

function localizedText(text) {
    return window.SmartFarmerI18n?.translateText(text) || text;
}

function localizedKey(key, fallback) {
    return window.SmartFarmerI18n?.translateKey(key) || localizedText(fallback);
}

function initializePasswordVisibilityToggles() {
    document.querySelectorAll("[data-password-toggle]").forEach((button) => {
        if (button.dataset.passwordToggleReady === "true") return;

        const input = document.getElementById(button.dataset.passwordTarget || "");
        if (!input || input.type !== "password") return;

        const openEye = button.querySelector("[data-eye-open]");
        const closedEye = button.querySelector("[data-eye-off]");

        button.dataset.passwordToggleReady = "true";
        button.addEventListener("click", () => {
            const showPassword = input.type === "password";
            input.type = showPassword ? "text" : "password";
            button.setAttribute("aria-pressed", String(showPassword));

            const labelKey = showPassword ? "auth.hidePassword" : "auth.showPassword";
            button.setAttribute("data-i18n-aria-label", labelKey);
            button.setAttribute(
                "aria-label",
                localizedKey(labelKey, showPassword ? "Hide password" : "Show password")
            );

            if (openEye) openEye.hidden = showPassword;
            if (closedEye) closedEye.hidden = !showPassword;
        });
    });
}

function authFetch(url, options = {}) {
    const headers = new Headers(options.headers || {});
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || "";
    if (csrfToken) headers.set("X-CSRFToken", csrfToken);
    return fetch(url, {
        ...options,
        headers,
        credentials: "same-origin"
    });
}


// ========================================
// REGISTRATION ELEMENTS
// ========================================

const registerForm = document.getElementById("registerForm");

const registrationSection =
    document.getElementById("registrationSection");

const otpSection =
    document.getElementById("otpSection");

const otpForm =
    document.getElementById("otpForm");

const emailInput =
    document.getElementById("email");

const phoneInput =
    document.getElementById("phone");

const emailStatus =
    document.getElementById("emailStatus");

const phoneStatus =
    document.getElementById("phoneStatus");

const passwordInput =
    document.getElementById("password");

const confirmPasswordInput =
    document.getElementById("confirm_password");

const passwordStatus =
    document.getElementById("passwordStatus");

const roleSelect =
    document.getElementById("role");

function initializeRoleChoices() {
    const group = document.querySelector("[data-role-choices]");
    if (!group || !roleSelect) return;

    document.body.classList.add("has-role-choices");

    const syncSelection = () => {
        group.querySelectorAll("[data-role-choice]").forEach((button) => {
            const selected = button.dataset.roleChoice === roleSelect.value;
            button.classList.toggle("is-selected", selected);
            button.setAttribute("aria-pressed", String(selected));
        });
    };

    group.querySelectorAll("[data-role-choice]").forEach((button) => {
        button.addEventListener("click", () => {
            roleSelect.value = button.dataset.roleChoice;
            roleSelect.dispatchEvent(new Event("change", { bubbles: true }));
            syncSelection();
        });
    });

    roleSelect.addEventListener("change", syncSelection);
    syncSelection();
}

initializeRoleChoices();

const registerButton =
    document.getElementById("registerButton");

const verifyButton =
    document.getElementById("verifyButton");

const resendButton =
    document.getElementById("resendOtpButton");

const resendCountdown =
    document.getElementById("resendCountdown");

const backToRegister =
    document.getElementById("backToRegister");

const authMessage =
    document.getElementById("authMessage");

const otpMessage =
    document.getElementById("otpMessage");

const otpEmailDisplay =
    document.getElementById("otpEmailDisplay");

const otpInput =
    document.getElementById("otp");


// ========================================
// REGISTRATION STATE
// ========================================

let registrationEmail = "";
let resendTimer = null;
let resendSeconds = 60;

let emailAvailable = false;
let phoneAvailable = false;

let emailCheckedValue = "";
let phoneCheckedValue = "";

let emailCheckNumber = 0;
let phoneCheckNumber = 0;


// ========================================
// EMAIL VALIDATION
// ========================================

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}


// ========================================
// PHONE VALIDATION
// ========================================

function isValidPhone(phone) {
    return /^[0-9+\-\s]{7,20}$/.test(phone);
}


// ========================================
// REAL-TIME EMAIL DUPLICATE CHECK
// ========================================

async function checkEmailAvailability() {

    if (!emailInput || !emailStatus) return;

    const email = emailInput.value.trim().toLowerCase();
    const requestNumber = ++emailCheckNumber;

    emailAvailable = false;
    emailCheckedValue = "";

    if (!email) {
        emailStatus.textContent = "";
        return;
    }

    if (!isValidEmail(email)) {
        emailStatus.textContent = localizedText("Please enter a valid email address.");
        emailStatus.className = "field-status error";
        return;
    }

    emailStatus.textContent = localizedText("Checking email...");
    emailStatus.className = "field-status";

    try {

        const response = await authFetch(
            `${API_URL}/check-availability`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                credentials: "same-origin",
                body: JSON.stringify({
                    email: email
                })
            }
        );

        const result = await response.json();

        if (requestNumber !== emailCheckNumber) return;

        if (!response.ok || !result.success) {
            throw new Error(result.message || "Email check failed.");
        }

        emailAvailable = result.email_available;
        emailCheckedValue = email;

        if (emailAvailable) {
            emailStatus.textContent = localizedText("✓ Email is available.");
            emailStatus.className = "field-status success";
        } else {
            emailStatus.textContent = localizedText("✕ This email is already registered or pending.");
            emailStatus.className = "field-status error";
        }

    } catch (error) {

        if (requestNumber !== emailCheckNumber) return;

        emailAvailable = false;
        emailCheckedValue = "";

        emailStatus.textContent = localizedText(error.message);
        emailStatus.className = "field-status error";
    }
}


// ========================================
// REAL-TIME PHONE DUPLICATE CHECK
// ========================================

async function checkPhoneAvailability() {

    if (!phoneInput || !phoneStatus) return;

    const phone = phoneInput.value.trim();
    const requestNumber = ++phoneCheckNumber;

    phoneAvailable = false;
    phoneCheckedValue = "";

    if (!phone) {
        phoneStatus.textContent = "";
        return;
    }

    if (!isValidPhone(phone)) {
        phoneStatus.textContent = localizedText("Please enter a valid phone number.");
        phoneStatus.className = "field-status error";
        return;
    }

    phoneStatus.textContent = localizedText("Checking phone number...");
    phoneStatus.className = "field-status";

    try {

        const response = await authFetch(
            `${API_URL}/check-availability`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                credentials: "same-origin",
                body: JSON.stringify({
                    phone: phone
                })
            }
        );

        const result = await response.json();

        if (requestNumber !== phoneCheckNumber) return;

        if (!response.ok || !result.success) {
            throw new Error(result.message || "Phone check failed.");
        }

        phoneAvailable = result.phone_available;
        phoneCheckedValue = phone;

        if (phoneAvailable) {
            phoneStatus.textContent = localizedText("✓ Phone number is available.");
            phoneStatus.className = "field-status success";
        } else {
            phoneStatus.textContent = localizedText("✕ This phone number is already registered or pending.");
            phoneStatus.className = "field-status error";
        }

    } catch (error) {

        if (requestNumber !== phoneCheckNumber) return;

        phoneAvailable = false;
        phoneCheckedValue = "";

        phoneStatus.textContent = localizedText(error.message);
        phoneStatus.className = "field-status error";
    }
}


// ========================================
// EMAIL INPUT DEBOUNCE
// ========================================

let emailDebounce = null;
let phoneDebounce = null;

if (emailInput) {

    emailInput.addEventListener("input", function() {

        clearTimeout(emailDebounce);

        emailAvailable = false;
        emailCheckedValue = "";

        emailStatus.textContent = "";
        emailStatus.className = "field-status";

        emailDebounce = setTimeout(
            checkEmailAvailability,
            600
        );
    });

    emailInput.addEventListener("blur", function() {
        clearTimeout(emailDebounce);
        checkEmailAvailability();
    });
}


// ========================================
// PHONE INPUT DEBOUNCE
// ========================================

if (phoneInput) {

    phoneInput.addEventListener("input", function() {

        clearTimeout(phoneDebounce);

        phoneAvailable = false;
        phoneCheckedValue = "";

        phoneStatus.textContent = "";
        phoneStatus.className = "field-status";

        phoneDebounce = setTimeout(
            checkPhoneAvailability,
            600
        );
    });

    phoneInput.addEventListener("blur", function() {
        clearTimeout(phoneDebounce);
        checkPhoneAvailability();
    });
}


// ========================================
// PASSWORD MATCH VALIDATION
// ========================================

function validatePasswords() {

    if (!passwordInput || !confirmPasswordInput) {
        return true;
    }

    const password = passwordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    if (!confirmPassword) {
        passwordStatus.textContent = "";
        passwordStatus.className = "field-status";
        return false;
    }

    if (password !== confirmPassword) {
        passwordStatus.textContent = localizedText("Passwords do not match.");
        passwordStatus.className = "field-status error";
        return false;
    }

    passwordStatus.textContent = localizedText("✓ Passwords match.");
    passwordStatus.className = "field-status success";

    return true;
}

function updatePasswordStrength() {
    if (!passwordInput) return;

    const meter = document.querySelector("[data-password-strength]");
    if (!meter) return;
    const track = meter.querySelector("[role='meter']");
    const fill = document.querySelector("[data-password-strength-fill]");
    const label = document.querySelector("[data-password-strength-label]");
    if (!track || !fill || !label) return;

    const password = passwordInput.value;
    meter.hidden = !password;
    if (!password) {
        track.setAttribute("aria-valuenow", "0");
        fill.style.width = "0%";
        label.textContent = "";
        meter.dataset.strength = "";
        return;
    }

    const score = Math.min(4, [
        password.length >= 8,
        password.length >= 12,
        /[a-z]/.test(password) && /[A-Z]/.test(password),
        /\d/.test(password) || /[^a-zA-Z0-9]/.test(password)
    ].filter(Boolean).length);
    const strengthKeys = [
        "register.strengthWeak",
        "register.strengthWeak",
        "register.strengthFair",
        "register.strengthGood",
        "register.strengthStrong"
    ];

    track.setAttribute("aria-valuenow", String(score));
    fill.style.width = `${score * 25}%`;
    label.textContent = localizedKey(strengthKeys[score], ["Weak", "Weak", "Fair", "Good", "Strong"][score]);
    meter.dataset.strength = ["", "weak", "weak", "fair", "good", "strong"][score];
}

if (passwordInput && confirmPasswordInput) {

    passwordInput.addEventListener(
        "input",
        () => {
            validatePasswords();
            updatePasswordStrength();
        }
    );

    updatePasswordStrength();

    confirmPasswordInput.addEventListener(
        "input",
        validatePasswords
    );
}


// ========================================
// OTP COUNTDOWN
// ========================================

function startResendCountdown() {

    clearInterval(resendTimer);

    resendSeconds = 60;

    if (!resendButton || !resendCountdown) return;

    resendButton.disabled = true;

    resendCountdown.textContent = localizedText(
        `You can request a new OTP in ${resendSeconds} seconds.`
    );

    resendTimer = setInterval(() => {

        resendSeconds--;

        if (resendSeconds <= 0) {

            clearInterval(resendTimer);

            resendButton.disabled = false;

            resendCountdown.textContent = localizedText(
                "You can request a new OTP now."
            );

            return;
        }

        resendCountdown.textContent = localizedText(
            `You can request a new OTP in ${resendSeconds} seconds.`
        );

    }, 1000);
}


// ========================================
// SHOW OTP SECTION
// ========================================

function showOtpSection(email) {

    registrationEmail = email;

    registrationSection.hidden = true;
    otpSection.hidden = false;

    otpEmailDisplay.textContent = email;

    otpInput.value = "";

    showMessage(
        otpMessage,
        "A verification code has been sent to your email.",
        "success"
    );

    startResendCountdown();

    otpInput.focus();
}


// ========================================
// REGISTRATION FORM SUBMISSION
// ========================================

if (registerForm) {

    registerForm.addEventListener(
        "submit",
        async function(event) {

            event.preventDefault();

            showMessage(authMessage, "");

            const data = Object.fromEntries(
                new FormData(registerForm).entries()
            );

            data.first_name = data.first_name.trim();
            data.last_name = data.last_name.trim();
            data.email = data.email.trim().toLowerCase();
            data.phone = data.phone.trim();

            // Basic validation
            if (!data.first_name || !data.last_name) {
                showMessage(
                    authMessage,
                    "Please enter your first name and last name."
                );
                return;
            }

            if (!isValidEmail(data.email)) {
                showMessage(authMessage, "Invalid email address.");
                return;
            }

            if (!isValidPhone(data.phone)) {
                showMessage(authMessage, "Invalid phone number.");
                return;
            }

            if (data.password.length < 8) {
                showMessage(
                    authMessage,
                    "Password must contain at least 8 characters."
                );
                return;
            }

            if (!validatePasswords()) {
                showMessage(
                    authMessage,
                    "Passwords do not match."
                );
                return;
            }

            // Ensure availability was checked for current values
            if (
                emailCheckedValue !== data.email ||
                phoneCheckedValue !== data.phone
            ) {

                await Promise.all([
                    checkEmailAvailability(),
                    checkPhoneAvailability()
                ]);

            }

            if (
                !emailAvailable ||
                !phoneAvailable ||
                emailCheckedValue !== data.email ||
                phoneCheckedValue !== data.phone
            ) {

                showMessage(
                    authMessage,
                    "Please enter available email and phone details."
                );

                return;
            }

            registerButton.disabled = true;
            registerButton.textContent = localizedText("Sending OTP...");

            try {

                const response = await authFetch(
                    `${API_URL}/register`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        credentials: "same-origin",
                        body: JSON.stringify(data)
                    }
                );

                const result = await response.json();

                if (!response.ok) {
                    throw new Error(
                        result.message || "Registration failed."
                    );
                }

                showOtpSection(result.email || data.email);

            } catch (error) {

                showMessage(
                    authMessage,
                    error.message
                );

            } finally {

                registerButton.disabled = false;
                registerButton.textContent = localizedKey("register.submit", "Create Account");

            }

        }
    );
}


// ========================================
// OTP VERIFICATION
// ========================================

if (otpForm) {

    otpForm.addEventListener(
        "submit",
        async function(event) {

            event.preventDefault();

            const otp = otpInput.value.trim();

            if (!/^\d{6}$/.test(otp)) {
                showMessage(
                    otpMessage,
                    "Please enter a valid 6-digit OTP."
                );
                return;
            }

            verifyButton.disabled = true;
            verifyButton.textContent = localizedText("Verifying...");

            showMessage(otpMessage, "");

            try {

                const response = await authFetch(
                    `${API_URL}/verify-otp`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        credentials: "same-origin",
                        body: JSON.stringify({
                            email: registrationEmail,
                            otp: otp
                        })
                    }
                );

                const result = await response.json();

                if (!response.ok) {
                    throw new Error(
                        result.message || "OTP verification failed."
                    );
                }

                showMessage(
                    otpMessage,
                    result.message,
                    "success"
                );

                clearInterval(resendTimer);

                verifyButton.textContent = localizedText("Verified!");

                setTimeout(() => {
                    window.location.href =
                        "/login-page?registered=1";
                }, 1500);

            } catch (error) {

                showMessage(
                    otpMessage,
                    error.message
                );

                otpInput.value = "";

            } finally {

                if (verifyButton.textContent !== localizedText("Verified!")) {
                    verifyButton.disabled = false;
                    verifyButton.textContent = localizedKey("otp.verifyEmail", "Verify Email");
                }

            }

        }
    );
}


// ========================================
// RESEND OTP
// ========================================

if (resendButton) {

    resendButton.addEventListener(
        "click",
        async function() {

            if (!registrationEmail) return;

            resendButton.disabled = true;
            resendButton.textContent = localizedText("Sending...");

            try {

                const response = await authFetch(
                    `${API_URL}/resend-otp`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        credentials: "same-origin",
                        body: JSON.stringify({
                            email: registrationEmail
                        })
                    }
                );

                const result = await response.json();

                if (!response.ok) {
                    throw new Error(
                        result.message || "Unable to resend OTP."
                    );
                }

                showMessage(
                    otpMessage,
                    result.message,
                    "success"
                );

                startResendCountdown();

            } catch (error) {

                showMessage(
                    otpMessage,
                    error.message
                );

                // Allow retry after a short delay if the server rejects it
                resendButton.disabled = false;

            } finally {

                resendButton.textContent = localizedKey("otp.resend", "Resend OTP");

            }

        }
    );
}


// ========================================
// BACK TO REGISTRATION
// ========================================

if (backToRegister) {

    backToRegister.addEventListener(
        "click",
        function() {

            clearInterval(resendTimer);

            otpSection.hidden = true;
            registrationSection.hidden = false;

            showMessage(authMessage, "");

        }
    );
}


// ========================================
// LOGIN FORM
// ========================================

document.querySelectorAll(
    '[data-auth-form="login"]'
).forEach(form => {

    form.addEventListener("submit", async function(event) {

        event.preventDefault();

        const messageBox =
            document.getElementById("authMessage");

        const button =
            form.querySelector("button[type='submit']");

        const data = Object.fromEntries(
            new FormData(form).entries()
        );

        showMessage(messageBox, "");

        button.disabled = true;
        button.textContent = localizedText("Please wait...");

        try {

            const response = await authFetch(
                `${API_URL}/login`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    credentials: "same-origin",
                    body: JSON.stringify(data)
                }
            );

            const result = await response.json();

            if (!response.ok) {
                throw new Error(
                    result.message || "Login failed."
                );
            }

            showMessage(
                messageBox,
                "Login successful! Redirecting...",
                "success"
            );

            setTimeout(() => {
                window.location.href = result.redirect;
            }, 800);

        } catch (error) {

            showMessage(
                messageBox,
                error.message
            );

        } finally {

            button.disabled = false;
            button.textContent = localizedKey("login.submit", "Login to Account");

        }

    });

});


// ========================================
// REGISTRATION SUCCESS MESSAGE
// ========================================

const params = new URLSearchParams(
    window.location.search
);

if (params.get("registered") === "1") {

    const messageBox =
        document.getElementById("authMessage");

    if (messageBox) {

        showMessage(
            messageBox,
            "Registration successful! Please login.",
            "success"
        );

    }
}


// ========================================
// FORGOT PASSWORD SYSTEM
// ========================================

let resetEmail = "";
let passwordResetToken = "";

let resetResendTimer = null;
let resetResendSeconds = 60;


// HTML sections
const loginSection =
    document.getElementById("loginSection");

const forgotPasswordSection =
    document.getElementById("forgotPasswordSection");

const resetOtpSection =
    document.getElementById("resetOtpSection");

const newPasswordSection =
    document.getElementById("newPasswordSection");


// Buttons
const showForgotPassword =
    document.getElementById("showForgotPassword");

const backToLogin =
    document.getElementById("backToLogin");

const backToForgotPassword =
    document.getElementById("backToForgotPassword");

const sendResetOtpButton =
    document.getElementById("sendResetOtpButton");

const verifyResetOtpButton =
    document.getElementById("verifyResetOtpButton");

const resendResetOtpButton =
    document.getElementById("resendResetOtpButton");

const resetPasswordButton =
    document.getElementById("resetPasswordButton");


// Forms
const forgotPasswordForm =
    document.getElementById("forgotPasswordForm");

const resetOtpForm =
    document.getElementById("resetOtpForm");

const newPasswordForm =
    document.getElementById("newPasswordForm");


// Inputs
const resetEmailInput =
    document.getElementById("resetEmail");

const resetOtpInput =
    document.getElementById("resetOtp");

const newPasswordInput =
    document.getElementById("newPassword");

const confirmNewPasswordInput =
    document.getElementById("confirmNewPassword");


// Messages
const forgotMessage =
    document.getElementById("forgotMessage");

const resetOtpMessage =
    document.getElementById("resetOtpMessage");

const newPasswordMessage =
    document.getElementById("newPasswordMessage");

const resetEmailDisplay =
    document.getElementById("resetEmailDisplay");

const resetResendCountdown =
    document.getElementById("resetResendCountdown");

const resetPasswordStatus =
    document.getElementById("resetPasswordStatus");


// ========================================
// SHOW / HIDE SECTIONS
// ========================================

function showPasswordResetSection(section) {

    const sections = [
        loginSection,
        forgotPasswordSection,
        resetOtpSection,
        newPasswordSection
    ];

    sections.forEach(item => {
        if (item) item.hidden = true;
    });

    if (section) section.hidden = false;
}


// ========================================
// OPEN FORGOT PASSWORD
// ========================================

if (showForgotPassword) {

    showForgotPassword.addEventListener("click", function() {

        showPasswordResetSection(forgotPasswordSection);

        showMessage(forgotMessage, "");

        resetEmailInput.value =
            document.getElementById("loginEmail")?.value || "";

    });
}


// ========================================
// BACK TO LOGIN
// ========================================

if (backToLogin) {

    backToLogin.addEventListener("click", function() {

        showPasswordResetSection(loginSection);

        showMessage(forgotMessage, "");

    });
}


// ========================================
// SEND PASSWORD RESET OTP
// ========================================

if (forgotPasswordForm) {

    forgotPasswordForm.addEventListener(
        "submit",
        async function(event) {

            event.preventDefault();

            const email = resetEmailInput.value
                .trim()
                .toLowerCase();

            if (!isValidEmail(email)) {

                showMessage(
                    forgotMessage,
                    "Please enter a valid email address."
                );

                return;
            }

            sendResetOtpButton.disabled = true;
            sendResetOtpButton.textContent = localizedText("Sending...");

            showMessage(forgotMessage, "");

            try {

                const response = await authFetch(
                    `${API_URL}/forgot-password`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        credentials: "same-origin",
                        body: JSON.stringify({
                            email: email
                        })
                    }
                );

                const result = await response.json();

                if (!response.ok || !result.success) {
                    throw new Error(
                        result.message || "Unable to process request."
                    );
                }

                resetEmail = email;

                resetEmailDisplay.textContent = email;

                resetOtpInput.value = "";

                showPasswordResetSection(resetOtpSection);

                showMessage(
                    resetOtpMessage,
                    result.message,
                    "success"
                );

                startResetResendCountdown();

            } catch (error) {

                showMessage(
                    forgotMessage,
                    error.message
                );

            } finally {

                sendResetOtpButton.disabled = false;

                sendResetOtpButton.textContent = localizedKey(
                    "reset.sendCode",
                    "Send Verification Code"
                );

            }

        }
    );
}


// ========================================
// PASSWORD RESET OTP COUNTDOWN
// ========================================

function startResetResendCountdown() {

    clearInterval(resetResendTimer);

    resetResendSeconds = 60;

    if (!resendResetOtpButton || !resetResendCountdown) {
        return;
    }

    resendResetOtpButton.disabled = true;

    resetResendCountdown.textContent = localizedText(
        `You can request a new OTP in ${resetResendSeconds} seconds.`
    );

    resetResendTimer = setInterval(() => {

        resetResendSeconds--;

        if (resetResendSeconds <= 0) {

            clearInterval(resetResendTimer);

            resendResetOtpButton.disabled = false;

            resetResendCountdown.textContent = localizedText(
                "You can request a new OTP now."
            );

            return;
        }

        resetResendCountdown.textContent = localizedText(
            `You can request a new OTP in ${resetResendSeconds} seconds.`
        );

    }, 1000);
}


// ========================================
// RESEND PASSWORD RESET OTP
// ========================================

if (resendResetOtpButton) {

    resendResetOtpButton.addEventListener(
        "click",
        async function() {

            if (!resetEmail) return;

            resendResetOtpButton.disabled = true;

            resendResetOtpButton.textContent = localizedText("Sending...");

            try {

                const response = await authFetch(
                    `${API_URL}/resend-reset-otp`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        credentials: "same-origin",
                        body: JSON.stringify({
                            email: resetEmail
                        })
                    }
                );

                const result = await response.json();

                if (!response.ok || !result.success) {
                    throw new Error(
                        result.message || "Unable to resend OTP."
                    );
                }

                showMessage(
                    resetOtpMessage,
                    result.message,
                    "success"
                );

                startResetResendCountdown();

            } catch (error) {

                showMessage(
                    resetOtpMessage,
                    error.message
                );

                resendResetOtpButton.disabled = false;

            } finally {

                resendResetOtpButton.textContent = localizedKey("otp.resend", "Resend OTP");

            }

        }
    );
}


// ========================================
// VERIFY PASSWORD RESET OTP
// ========================================

if (resetOtpForm) {

    resetOtpForm.addEventListener(
        "submit",
        async function(event) {

            event.preventDefault();

            const otp = resetOtpInput.value.trim();

            if (!/^\d{6}$/.test(otp)) {

                showMessage(
                    resetOtpMessage,
                    "Please enter a valid 6-digit OTP."
                );

                return;
            }

            verifyResetOtpButton.disabled = true;

            verifyResetOtpButton.textContent = localizedText("Verifying...");

            showMessage(resetOtpMessage, "");

            try {

                const response = await authFetch(
                    `${API_URL}/verify-reset-otp`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        credentials: "same-origin",
                        body: JSON.stringify({
                            email: resetEmail,
                            otp: otp
                        })
                    }
                );

                const result = await response.json();

                if (!response.ok || !result.success) {
                    throw new Error(
                        result.message || "OTP verification failed."
                    );
                }

                if (!result.reset_token) {
                    throw new Error(
                        "Reset session could not be created."
                    );
                }

                passwordResetToken = result.reset_token;

                clearInterval(resetResendTimer);

                showPasswordResetSection(newPasswordSection);

                showMessage(
                    newPasswordMessage,
                    "Email verified. Please create your new password.",
                    "success"
                );

                newPasswordInput.focus();

            } catch (error) {

                showMessage(
                    resetOtpMessage,
                    error.message
                );

                resetOtpInput.value = "";

            } finally {

                verifyResetOtpButton.disabled = false;

                verifyResetOtpButton.textContent = localizedKey("otp.verify", "Verify Code");

            }

        }
    );
}


// ========================================
// NEW PASSWORD MATCH VALIDATION
// ========================================

function validateNewPasswords() {

    if (!newPasswordInput || !confirmNewPasswordInput) {
        return false;
    }

    const password = newPasswordInput.value;

    const confirmPassword =
        confirmNewPasswordInput.value;

    if (!confirmPassword) {

        resetPasswordStatus.textContent = "";

        resetPasswordStatus.className = "field-status";

        return false;
    }

    if (password !== confirmPassword) {

        resetPasswordStatus.textContent = localizedText(
            "Passwords do not match."
        );

        resetPasswordStatus.className =
            "field-status error";

        return false;
    }

    resetPasswordStatus.textContent = localizedText(
        "✓ Passwords match."
    );

    resetPasswordStatus.className =
        "field-status success";

    return true;
}

if (newPasswordInput && confirmNewPasswordInput) {

    newPasswordInput.addEventListener(
        "input",
        validateNewPasswords
    );

    confirmNewPasswordInput.addEventListener(
        "input",
        validateNewPasswords
    );
}


// ========================================
// RESET PASSWORD
// ========================================

if (newPasswordForm) {

    newPasswordForm.addEventListener(
        "submit",
        async function(event) {

            event.preventDefault();

            const password = newPasswordInput.value;

            const confirmPassword =
                confirmNewPasswordInput.value;

            if (!passwordResetToken) {

                showMessage(
                    newPasswordMessage,
                    "Your reset session has expired. Please verify your email again."
                );

                return;
            }

            if (password.length < 8) {

                showMessage(
                    newPasswordMessage,
                    "Password must contain at least 8 characters."
                );

                return;
            }

            if (!validateNewPasswords()) {

                showMessage(
                    newPasswordMessage,
                    "Passwords do not match."
                );

                return;
            }

            resetPasswordButton.disabled = true;

            resetPasswordButton.textContent = localizedText("Updating...");

            showMessage(newPasswordMessage, "");

            try {

                const response = await authFetch(
                    `${API_URL}/reset-password`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        credentials: "same-origin",
                        body: JSON.stringify({
                            reset_token: passwordResetToken,
                            password: password,
                            confirm_password: confirmPassword
                        })
                    }
                );

                const result = await response.json();

                if (!response.ok || !result.success) {
                    throw new Error(
                        result.message || "Password reset failed."
                    );
                }

                // Prevent reuse of this reset token.
                passwordResetToken = "";

                showMessage(
                    newPasswordMessage,
                    result.message,
                    "success"
                );

                resetPasswordButton.textContent = localizedText("Password Updated!");

                setTimeout(() => {

                    window.location.href =
                        "/login-page?password_reset=1";

                }, 1500);

            } catch (error) {

                showMessage(
                    newPasswordMessage,
                    error.message
                );

            } finally {

                if (passwordResetToken) {

                    resetPasswordButton.disabled = false;

                    resetPasswordButton.textContent = localizedKey(
                        "reset.submit",
                        "Reset Password"
                    );
                }

            }

        }
    );
}


// ========================================
// BACK TO FORGOT PASSWORD
// ========================================

if (backToForgotPassword) {

    backToForgotPassword.addEventListener(
        "click",
        function() {

            clearInterval(resetResendTimer);

            showPasswordResetSection(forgotPasswordSection);

            showMessage(forgotMessage, "");

        }
    );
}


// ========================================
// LOGIN SUCCESS MESSAGES
// ========================================

const loginParams = new URLSearchParams(
    window.location.search
);

if (loginParams.get("password_reset") === "1") {

    const loginMessage =
        document.getElementById("authMessage");

    showMessage(
        loginMessage,
        "Password reset successful! Please login with your new password.",
        "success"
    );

}

initializePasswordVisibilityToggles();

