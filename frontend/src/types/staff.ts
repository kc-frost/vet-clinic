export type StaffPosition = "Veterinarian" | "VetAssistant" | "ServiceRepresentative";

export type Staff = {
  staffID: number;
  name: string;
  StaffNumber: string | null;
  email: string | null;
  position: StaffPosition;
};

export type StaffCreate = Omit<Staff, "staffID">;
