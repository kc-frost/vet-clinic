export type AppointmentIssueRow = {
	issueID: number;
	appointmentID: number;
	issueType: string;
	issueKey: string;
	label: string;
	createdAt: string;
};

export type UnderReviewAssignedStaff = {
	staffID: number;
	userID: number;
	assignedRoleKey: string;
	name: string;
	positionTitle: string;
};

export type UnderReviewAppointment = {
	appointmentID: number;
	userID: number;
	petID: number | null;
	roomNumber: number | null;
	reasonKey: string;
	reasonDetails: string;
	petName: string;
	ownerName: string;
	startAt: string;
	endAt: string;
	durationMinutes: number;
	underReview: boolean;
	isCanceled: boolean;
	issues: AppointmentIssueRow[];
	assignedStaff: UnderReviewAssignedStaff[];
};
