import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AuthForm from "../../components/AuthForm";
import { login } from "../../api/auth";

export default function Login() {
	const navigate = useNavigate();
	const [isSubmitting, setIsSubmitting] = useState(false);

	async function handleLogin(email: string, password: string) {
		setIsSubmitting(true);
		try {
			await login({ email, password });
			navigate("/staff/inventory");
		} catch (err) {
			const message = err instanceof Error ? err.message : "Login failed. Please check your credentials and try again.";
			throw new Error(message);
		} finally {
			setIsSubmitting(false);
		}
	}

	return <AuthForm mode="login" onSubmit={handleLogin} isSubmitting={isSubmitting} />;
}
