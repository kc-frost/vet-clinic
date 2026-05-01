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
			await login(email, password);
			navigate("/");
		} catch {
			throw new Error("The email or password you entered is incorrect. Please try again.");
		} finally {
			setIsSubmitting(false);
		}
	} 

	return <AuthForm mode="login" onSubmit={handleLogin} isSubmitting={isSubmitting} />;
}
