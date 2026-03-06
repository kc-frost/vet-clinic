export type StaffRole = "VET" | "PET_GROOMER";

export interface Staff {
	staffID: number;
	name: string;
	StaffNumber: string | null;
	email: string | null;
	position: string;
	role: StaffRole;
}

export interface StaffCreate {
	name: string;
	StaffNumber: string | null;
	email: string | null;
	position: string;
	role: StaffRole;
}