export type Appointment = {
  appointmentID: number;
  userID: number;
  userEmail: string;
  staffID: number;
  roomNumber: number;
  petID: number | null;
  reasonKey: string;
  date: string;
  durationMinutes: number;
  endDateTime: string;
  equipmentUsed: string;
};