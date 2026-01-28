export type Person = {
  personID: number;
  fullName: string;
  role: string;
  phoneNumber: string | null;
  status: string | null;
};

/*  NOTE: FOR FUTURE, WORK ON MOVING AWAY FROM NULLS AND STRICTER ATTRIBUTES IN DB AND UPDATE FRONTEND HANDLING,
THIS EXTENDS TO ALL OTHER TYPES CURRENTLY, people, resources, rooms.ts */