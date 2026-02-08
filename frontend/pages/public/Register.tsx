import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AuthForm from "../../components/AuthForm";
import { register } from "../../api/auth";

export default function Register() {
	const navigate = useNavigate();
	const [isSubmitting, setIsSubmitting] = useState(false);

	async function handleRegister(email: string, password: string) {
		setIsSubmitting(true);
		try {
			await register({ email, password });

			// After successful register, send them to login
			navigate("/login");
		} catch (err) {
			const message = err instanceof Error ? err.message : "Registration failed. Please try again.";
			throw new Error(message);
		} finally {
			setIsSubmitting(false);
		}
	}

	return <AuthForm mode="register" onSubmit={handleRegister} isSubmitting={isSubmitting} />;
}
