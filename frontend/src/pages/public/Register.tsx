import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AuthForm from "../../components/AuthForm";
import { register } from "../../api/auth";

export default function Register() {
	// react-router hook that lets this component redirect the user after register
	const navigate = useNavigate();

	// used to disable inputs + button while the register request is running
	const [isSubmitting, setIsSubmitting] = useState(false);

	// this function gets passed into <AuthForm />
	// AuthForm calls it with (email, password, adminCode?) after its own validation passes
	// this component does the actual API call and decides what happens next
	async function handleRegister(email: string, password: string, adminCode?: string) {
		setIsSubmitting(true);
		try {
			// calls POST /api/auth/register through api/auth.ts
			// adminCode is optional and will be undefined if the user left it blank
			await register(email, password, adminCode);

			// successful register automatically logs in the user in here
			// redirects to the home page
			navigate("/");
		} catch (err) {
			// AuthForm expects onSubmit to throw if something fails
			// throwing here lets AuthForm show a single "formError" message box
			const message = err instanceof Error ? err.message : "Registration failed. Please try again.";
			throw new Error(message);
		} finally {
			// always re-enable inputs, even if the request failed
			setIsSubmitting(false);
		}
	}

	// mode="register" tells AuthForm to show the admin code input and use register labels
	// isSubmitting disables inputs and shows "Working..." on the submit button
	return <AuthForm mode="register" onSubmit={handleRegister} isSubmitting={isSubmitting} />;
}