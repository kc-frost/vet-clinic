import nodemailer from "nodemailer";

let cachedTransporter = null;

function getMailerTransporter() {
	/*
		Reuse the same transporter once it has already been created
		so we do not rebuild the mail connection config every time.
	*/
	if (cachedTransporter) {
		return cachedTransporter;
	}

	/*
		Create the nodemailer transporter from environment variables.
		This keeps mail server settings outside the code.
	*/
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
	/*
		Require the basic mail fields before trying to send.
	*/
	if (!to || !subject || !text) {
		throw new Error("Missing mail fields");
	}

	const transporter = getMailerTransporter();

	/*
		Send the email using the configured transporter.
		Use MAIL_FROM when provided, otherwise fall back to MAIL_USER.
	*/
	await transporter.sendMail({
		from: process.env.MAIL_FROM || process.env.MAIL_USER,
		to,
		subject,
		text,
	});
}