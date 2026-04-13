export type RoomType = "EXAM" | "IMAGING" | "SURGERY" | "GROOMING";

export interface Room {
	roomNumber: number;
	roomType: RoomType;
	capacity: number;
	isActive?: boolean;
	deactivatedAt?: string | null;
}

export interface RoomCreate {
	roomNumber: number;
	roomType: RoomType;
	capacity: number;
}
