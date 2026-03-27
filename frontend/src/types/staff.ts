/*
	These are the staff role keys for scheduling.
	This is not the same thing as customer.userType.

	userType is:
	- CUSTOMER
	- STAFF
	- ADMIN

	These are the actual staff capabilities.
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

/*
	This is the staff shape returned from GET /api/staff.

	It is not just one raw staff row anymore.
	The backend now builds this from:
	- staff
	- customer
	- staff_role

	So customer has the profile/contact info,
	staff has the employee-specific info,
	and staff_role gives the roleKeys array.
*/
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

/*
	This is what gets sent when admin creates a staff profile.

	The admin is not typing all the person info into staff anymore.
	The user already has an account.
	We just link that userID, give them a staff number,
	a display title, and the role keys they can do.
*/
export interface StaffCreate {
	userID: number;
	staffNumber: string;
	positionTitle: string;
	roleKeys: StaffRoleKey[];
}

/*
	This is for the admin side when picking which existing user
	account should be linked to a staff profile.

	It gives enough info for the admin to tell who the account is
	and whether that user was already linked before.
*/
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