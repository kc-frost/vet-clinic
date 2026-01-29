export type RoomType = "CheckupRoom" | "XrayRoom" | "SurgeryRoom";

export type Room = {
  roomNumber: number;
  roomType: RoomType;
  capacity: number;
};

export type RoomCreate = Omit<Room, "roomNumber">;
