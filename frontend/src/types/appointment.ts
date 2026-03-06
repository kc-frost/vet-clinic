// shared appointment shape used by both the admin appointments page
// and the normal user profile appointment history

export type Appointment = {
  appointmentID: number;
  userID: number;
  staffID: number;
  roomNumber: number;
  petID: number | null;

  reasonKey: string;
  date: string;
  durationMinutes: number;

  // these fields come back on the admin all appointments route
  userEmail?: string;
  endDateTime?: string;
  equipmentUsed?: string;
};