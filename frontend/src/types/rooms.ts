export type RoomType = "EXAM" | "IMAGING" | "SURGERY" | "GROOMING";

export interface Room {
	roomNumber: number;
	roomType: RoomType;
	capacity: number;
}

export interface RoomCreate {
	roomNumber: number;
	roomType: RoomType;
	capacity: number;
}