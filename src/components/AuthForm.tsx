import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import "../styles/authForm.css";

type AuthMode = "login" | "register";

type AuthFormProps = {
	mode: AuthMode;
	onSubmit: (email: string, password: string) => void | Promise<void>;
	isSubmitting?: boolean;
};

function isValidEmail(emailRaw: string): boolean {
	const email = emailRaw.trim();
	const basicPattern = /^[^\s@]+@[^\s@]+\.(com|org|net|edu|gov)$/i;
	return basicPattern.test(email);
}

function validatePassword(password: string): string {
	if (password.length < 8) return "Password must be at least 8 characters.";
	if (!/[a-z]/.test(password)) return "Password must include a lowercase letter.";
	if (!/[A-Z]/.test(password)) return "Password must include an uppercase letter.";
	if (!/[0-9]/.test(password)) return "Password must include a number.";
	if (!/[^A-Za-z0-9]/.test(password)) return "Password must include a special character.";
	return "";
}

export default function AuthForm({ mode, onSubmit, isSubmitting = false }: AuthFormProps) {
	const title = mode === "login" ? "Login" : "Register";
	const primaryBtnText = mode === "login" ? "Login" : "Create account";

	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);

	const [formError, setFormError] = useState<string>("");
	const [fieldEmailError, setFieldEmailError] = useState<string>("");
	const [fieldPasswordError, setFieldPasswordError] = useState<string>("");

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

	function validateAll(): boolean {
		setFormError("");
		let ok = true;

		if (!isValidEmail(email)) {
			setFieldEmailError("Enter a valid email (example@domain.com).");
			ok = false;
		} else {
			setFieldEmailError("");
		}

		const passwordMessage = validatePassword(password);
		if (passwordMessage) {
			setFieldPasswordError(passwordMessage);
			ok = false;
		} else {
			setFieldPasswordError("");
		}

		return ok;
	}

	async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
		e.preventDefault();

		const ok = validateAll();
		if (!ok) return;

		try {
			setFormError("");
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

					<button type="submit" className="auth-submit" disabled={isSubmitting}>
						{isSubmitting ? "Working..." : primaryBtnText}
					</button>

					{helperLink}
				</form>
			</div>
		</div>
	);
}
