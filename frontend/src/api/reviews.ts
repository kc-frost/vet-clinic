import { api } from "./client";

export type SubmitReviewPayload = {
	rating: number;
	reviewText?: string;
};

export type SubmitReviewResponse = {
	message: string;
	appointmentID: number;
	rating: number;
	reviewText: string;
};

export function submitAppointmentReview(
	appointmentID: number,
	payload: SubmitReviewPayload
) {
	return api<SubmitReviewResponse>(`/reviews/${appointmentID}`, {
		method: "POST",
		body: payload,
	});
}