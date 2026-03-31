/*
	These are the staff role keys for scheduling
	This is not the same thing as customer.userType

	userType is:
	- CUSTOMER
	- STAFF
	- ADMIN

	These are the actual staff capabilities
*/
export type StaffRoleKey =
	| "GENERAL"
	| "SURGEON"
	| "DENTIST"
	| "GROOMER"
	| "XRAY_TECH"
	| "ULTRASOUND_TECH"
	| "SURGEON_ASSISTANT"
	| "TECHNICIAN";

export type UserType = "CUSTOMER" | "STAFF" | "ADMIN";

export interface Staff {
	staffID: number;
	userID: number;
	staffNumber: string | null;
	positionTitle: string | null;
	legalFirstName: string | null;
	legalLastName: string | null;
	email: string | null;
	phone: string | null;
	addressLine1: string | null;
	city: string | null;
	state: string | null;
	zipCode: string | null;
	userType: UserType;
	roleKeys: StaffRoleKey[];
}

export interface StaffCreate {
	userID: number;
	staffNumber: string;
	positionTitle: string;
	roleKeys: StaffRoleKey[];
}

export interface StaffUserCandidate {
	userID: number;
	username: string | null;
	email: string | null;
	legalFirstName: string | null;
	legalLastName: string | null;
	userType: UserType;
	createdAt: string;
	linkedStaffID: number | null;
	alreadyLinkedToStaff: boolean;
	totalReservations: number;
	pastReservations: number;
	upcomingReservations: number;
}

export type MyStaffProfile = {
	staffID: number;
	userID: number;
	staffNumber: string | null;
	positionTitle: string | null;
	legalFirstName: string | null;
	legalLastName: string | null;
	email: string | null;
	phone: string | null;
	roleKeys: StaffRoleKey[];
};

export type StaffAvailabilityRow = {
	availabilityID?: number;
	dayOfWeek: number;
	startTime: string;
	endTime: string;
};

export type StaffAppointment = {
	appointmentID: number;
	petName: string;
	service: string;
	appointmentDate: string;
	appointmentTime: string;
	appointmentDateTime: string;
	assignedRoleKey: StaffRoleKey | string;
};

export type StaffNotification = {
	notificationID: number;
	type: string;
	title: string;
	message: string;
	channel: string;
	isRead: boolean;
	createdAt: string;
};
