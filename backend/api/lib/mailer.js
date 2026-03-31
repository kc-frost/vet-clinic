import nodemailer from "nodemailer";

let cachedTransporter = null;

function getMailerTransporter() {
	if (cachedTransporter) {
		return cachedTransporter;
	}

	cachedTransporter = nodemailer.createTransport({
		host: process.env.MAIL_HOST,
		port: Number(process.env.MAIL_PORT || 587),
		secure: String(process.env.MAIL_SECURE || "false") === "true",
		auth: {
			user: process.env.MAIL_USER,
			pass: process.env.MAIL_PASS,
		},
	});

	return cachedTransporter;
}

export async function sendEmail({ to, subject, text }) {
	if (!to || !subject || !text) {
		throw new Error("Missing mail fields");
	}

	const transporter = getMailerTransporter();

	await transporter.sendMail({
		from: process.env.MAIL_FROM || process.env.MAIL_USER,
		to,
		subject,
		text,
	});
}
