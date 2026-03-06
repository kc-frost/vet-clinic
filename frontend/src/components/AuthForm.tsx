import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import "../styles/authForm.css";

type AuthMode = "login" | "register";

type AuthFormProps = {
	mode: AuthMode;
	onSubmit: (email: string, password: string, adminCode?: string) => void | Promise<void>;
	isSubmitting?: boolean;
};

// simple email format check used by this form
// trimming first avoids rejecting valid emails because of accidental spaces
// pattern rules used here:
//  1) one or more non-space, non-@ chars
//  2) then "@"
//  3) then one or more non-space, non-@ chars
//  4) then "."
//  5) then a top-level domain that is one of: com, org, net, edu, gov
// note: backend has its own validation too, this is just UI-side feedback
function isValidEmail(emailRaw: string): boolean {
	const email = emailRaw.trim();
	const basicPattern = /^[^\s@]+@[^\s@]+\.(com|org|net|edu|gov)$/i;
	return basicPattern.test(email);
}

// password rules used by this form:
//  length: at least 8 characters
//  must contain: at least 1 lowercase letter
//  must contain: at least 1 uppercase letter
//  must contain: at least 1 digit
//  must contain: at least 1 non-alphanumeric character (special character)
// returns:
//  empty string => valid
//  non-empty string => validation message to show in the UI
function validatePassword(password: string): string {
	if (password.length < 8) return "Password must be at least 8 characters.";
	if (!/[a-z]/.test(password)) return "Password must include a lowercase letter.";
	if (!/[A-Z]/.test(password)) return "Password must include an uppercase letter.";
	if (!/[0-9]/.test(password)) return "Password must include a number.";
	if (!/[^A-Za-z0-9]/.test(password)) return "Password must include a special character.";
	return "";
}

// adminCode is optional, but if the user types something, it must be exactly 10 characters
// returns:
//  empty string => valid (including blank)
//  non-empty string => validation message to show in the UI
function validateAdminCode(adminCodeRaw: string): string {
	const code = adminCodeRaw.trim();
	if (!code) return "";
	if (code.length !== 10) return "Admin code must be exactly 10 characters.";
	return "";
}

export default function AuthForm({ mode, onSubmit, isSubmitting = false }: AuthFormProps) {
	// mode controls the displayed text and whether the admin code input shows up
	const title = mode === "login" ? "Login" : "Register";
	const primaryBtnText = mode === "login" ? "Login" : "Create account";

	// controlled inputs (react state is the source of truth for the input values)
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [adminCode, setAdminCode] = useState("");

	// toggles control whether password fields are masked
	const [showPassword, setShowPassword] = useState(false);
	const [showAdminCode, setShowAdminCode] = useState(false);

	// error state is split into:
	//  formError: general errors (like a failed request)
	//  field*Error: per-field validation messages
	const [formError, setFormError] = useState<string>("");
	const [fieldEmailError, setFieldEmailError] = useState<string>("");
	const [fieldPasswordError, setFieldPasswordError] = useState<string>("");
	const [fieldAdminCodeError, setFieldAdminCodeError] = useState<string>("");

	// helperLink changes depending on whether this is the login or register screen
	// useMemo avoids recreating the jsx on every render unless mode changes
	const helperLink = useMemo(() => {
		if (mode === "login") {
			return (
				<p className="auth-helper">
					Haven&apos;t registered yet? <Link to="/register">Register</Link>
				</p>
			);
		}
		return (
			<p className="auth-helper">
				Already registered? <Link to="/login">Log in</Link>
			</p>
		);
	}, [mode]);

	// runs client-side validation and fills the field error states
	// returns true only if every required field passes validation
	function validateAll(): boolean {
		setFormError("");
		let ok = true;

		// email validation
		if (!isValidEmail(email)) {
			setFieldEmailError("Enter a valid email (example@domain.com).");
			ok = false;
		} else {
			setFieldEmailError("");
		}

		// password validation
		const passwordMessage = validatePassword(password);
		if (passwordMessage) {
			setFieldPasswordError(passwordMessage);
			ok = false;
		} else {
			setFieldPasswordError("");
		}

		// admin code validation happens only on register mode
		if (mode === "register") {
			const adminCodeMessage = validateAdminCode(adminCode);
			if (adminCodeMessage) {
				setFieldAdminCodeError(adminCodeMessage);
				ok = false;
			} else {
				setFieldAdminCodeError("");
			}
		} else {
			setFieldAdminCodeError("");
		}

		return ok;
	}

	// form submit handler
	// preventDefault stops the browser from reloading the page on submit
	// calls onSubmit from the parent page (login/register page decides what API call to do)
	async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
		e.preventDefault();

		const ok = validateAll();
		if (!ok) return;

		try {
			setFormError("");

			// only send adminCode for register mode, and only if it is not blank
			if (mode === "register") {
				const trimmedAdminCode = adminCode.trim();
				await onSubmit(email.trim(), password, trimmedAdminCode ? trimmedAdminCode : undefined);
				return;
			}

			await onSubmit(email.trim(), password);
		} catch (err) {
			setFormError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
		}
	}

	return (
		<div className="auth-page">
			<div className="auth-card">
				<h1 className="auth-title">{title}</h1>
				<p className="auth-subtitle">Veterinary Clinic + Doggy Daycare</p>

				{/* general error box for request failures */}
				{formError ? <div className="auth-form-error">{formError}</div> : null}

				<form className="auth-form" onSubmit={handleSubmit}>
					<label className="auth-label">
						Email
						<input
							className="auth-input"
							type="email"
							value={email}
							onChange={(e) => {
								setEmail(e.target.value);

								// typing clears existing error messages so the UI updates immediately
								if (fieldEmailError) setFieldEmailError("");
								if (formError) setFormError("");
							}}
							placeholder="you@example.com"
							autoComplete="email"
							disabled={isSubmitting}
						/>
					</label>
					{fieldEmailError ? <div className="auth-field-error">{fieldEmailError}</div> : null}

					<label className="auth-label">
						Password
						<div className="auth-password-row">
							<input
								className="auth-input auth-input--password"
								type={showPassword ? "text" : "password"}
								value={password}
								onChange={(e) => {
									setPassword(e.target.value);

									// typing clears existing error messages so the UI updates immediately
									if (fieldPasswordError) setFieldPasswordError("");
									if (formError) setFormError("");
								}}
								placeholder="••••••••"
								autoComplete={mode === "login" ? "current-password" : "new-password"}
								disabled={isSubmitting}
							/>
							<button
								type="button"
								className="auth-toggle"
								onClick={() => setShowPassword((v) => !v)}
								aria-label={showPassword ? "Hide password" : "Show password"}
								disabled={isSubmitting}
							>
								{showPassword ? "Hide" : "Show"}
							</button>
						</div>
					</label>
					{fieldPasswordError ? <div className="auth-field-error">{fieldPasswordError}</div> : null}

					{/* admin code is only shown when registering */}
					{mode === "register" ? (
						<>
							<label className="auth-label">
								Admin Code (optional)
								<div className="auth-password-row">
									<input
										className="auth-input auth-input--password"
										type={showAdminCode ? "text" : "password"}
										value={adminCode}
										onChange={(e) => {
											setAdminCode(e.target.value);

											// typing clears existing error messages so the UI updates immediately
											if (fieldAdminCodeError) setFieldAdminCodeError("");
											if (formError) setFormError("");
										}}
										placeholder="(optional)"
										autoComplete="off"
										maxLength={10}
										disabled={isSubmitting}
									/>
									<button
										type="button"
										className="auth-toggle"
										onClick={() => setShowAdminCode((v) => !v)}
										aria-label={showAdminCode ? "Hide admin code" : "Show admin code"}
										disabled={isSubmitting}
									>
										{showAdminCode ? "Hide" : "Show"}
									</button>
								</div>
							</label>
							{fieldAdminCodeError ? <div className="auth-field-error">{fieldAdminCodeError}</div> : null}
						</>
					) : null}

					<button type="submit" className="auth-submit" disabled={isSubmitting}>
						{isSubmitting ? "Working..." : primaryBtnText}
					</button>

					{helperLink}
				</form>
			</div>
		</div>
	);
}