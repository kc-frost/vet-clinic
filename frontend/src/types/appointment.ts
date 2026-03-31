// shared appointment shape used by admin appointments and user appointment history

export type Appointment = {
	appointmentID: number;
	userID: number;
	roomNumber: number | null;
	petID: number | null;

	reasonKey: string;
	date: string;
	durationMinutes: number;

	// admin display fields
	userEmail?: string;
	endDateTime?: string;
	equipmentUsed?: string;
	roomType?: string;
	assignedStaffSummary?: string;
};
