// shared appointment shape used by admin appointments and user appointment history

export type Appointment = {
	appointmentID: number;
	userID: number;
	roomNumber: number | null;
	petID: number | null;
	reasonKey: string;
	date: string;
	durationMinutes: number;
	isCanceled?: number;
	userEmail?: string;
	petName?: string;
	endDateTime?: string;
	equipmentUsed?: string;
	roomType?: string;
	assignedStaffSummary?: string;
	summaryIsFinalized?: number | boolean;
	canceledByUserID?: number | null;
	canceledByType?: "ADMIN" | "STAFF" | "CUSTOMER" | null;
	cancellationReason?: string | null;
	canceledAt?: string | null;
	canceledByName?: string | null;
	rating?: number | null;
	reviewText?: string | null;
	reviewCreatedAt?: string | null;
};