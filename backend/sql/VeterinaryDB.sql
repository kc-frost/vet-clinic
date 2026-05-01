drop database if exists veterinarianDB;
create database veterinarianDB;
use veterinarianDB;

create table veterinary(
	branch int auto_increment primary key,
	address varchar(255) unique,
	name varchar(255)
);

create table medicine(
	ndc int primary key,
	medicineName varchar(255),
	medicineType varchar(255), -- examples: anesthetic, painkiller, antibiotic
	manufactorTime timestamp,
	expirationDate timestamp
);

create table customer(
	userID int auto_increment primary key,
	username varchar(255),
	email varchar(255) unique,
	password varchar(255),

	-- soft delete style account deactivation allows for history and or analytics 
	isDeactivated boolean not null default false,
	deactivatedAt datetime null,

	-- profile/contact fields for the user
	-- auto populated by first appointment form or filled out by user in user profile
	legalFirstName varchar(255),
	legalLastName varchar(255),
	phone varchar(20),
	addressLine1 varchar(255),
	city varchar(255),
	state varchar(2),
	zipCode varchar(10),

	address varchar(255),
	-- text so that user can type paragraph into user biography
	userBio text,

	-- website account identity type, not staff capability role
	-- expected values: CUSTOMER, STAFF, ADMIN
	userType varchar(20) not null default 'CUSTOMER',

	-- createdAt is for storing date of user account registration
	createdAt datetime not null default current_timestamp,

    -- stores file image path for user profile picture, pic is stored in server and retrieved
    profileImagePath varchar(500)
);

-- pets belong to a customer, one customer can have many pets
-- pet table stores the current info/facts for the pet profile
-- fields update over time as pet info changes
create table pet(
	petID int auto_increment primary key,
	userID int not null,
	petName varchar(255) not null,

	petType varchar(50), -- DOG, CAT, OTHER, etc
	breed varchar(255),
	petSex varchar(20), -- MALE, FEMALE, UNKNOWN
	spayedNeutered varchar(20), -- YES, NO, UNKNOWN

	age int,
	weight int, -- in lbs
	height int, -- in inches
	behavior varchar(255), -- stores behavior notes for pet

	-- current / historical health profile fields
	currentMedications text,
	medicationHistory text,
	knownAllergies text,
	currentConditions text,
	pastInjuriesConditions text,
	vaccinationsUpToDate varchar(10), -- Yes, No, Unsure
	heartwormPreventionCurrent varchar(20), -- Yes, No, Unsure, NotApplicable

	foreign key (userID) references customer(userID)
);

-- staff is the clinic employee extension of a normal website account
-- user profile/contact info should come from customer, not be duplicated here
create table staff(
	staffID int auto_increment primary key,
	userID int not null unique,
	staffNumber varchar(12) unique, -- includes dashes
	positionTitle varchar(255), -- human readable job title for display

	-- staff rows stay for history, but removed staff is not schedulable
	isActive boolean not null default true,
	deactivatedAt datetime null,

	foreign key (userID) references customer(userID)
);

-- stores what staff scheduling capabilities a staff member possesses
-- examples: GP_VET, SURGEON, DENTIST, GROOMER, XRAY_TECH, ULTRASOUND_TECH, SURGEON_ASSISTANT
create table staff_role(
	staffID int not null,
	roleKey varchar(50) not null,
	primary key (staffID, roleKey),
	foreign key (staffID) references staff(staffID)
);

-- recurring weekly availability
-- one continuous block per day per staff member
-- if a day has no row for the staff member, they are unavailable that day
create table staff_availability(
	availabilityID int auto_increment primary key,
	staffID int not null,
	dayOfWeek tinyint not null, -- 1=Monday ... 7=Sunday
	startTime time not null,
	endTime time not null,
	unique (staffID, dayOfWeek),
	foreign key (staffID) references staff(staffID)
);

create table contactinfo(
	address varchar(255),
	generalPhoneNumber varchar(12), -- includes dashes
	branchNumber varchar(12), -- includes dashes
	email varchar(255),
	foreign key (address) references veterinary(address)
);

-- this table represents both consumables and non-consumables
-- itemKey is the internal key used in backend logic
-- isConsumable tells backend if quantity means stock vs capacity based
create table inventory(
	itemID int auto_increment primary key,
	itemType varchar(50),
	itemKey varchar(255) unique,
	displayName varchar(255),
	isConsumable boolean not null default false,
	quantity int not null default 0,
	itemDescription text,

	-- inventory rows stay for history and issue resolution
	isActive boolean not null default true,
	deactivatedAt datetime null
);

create table leasings(
	leasingID int auto_increment primary key,
	leasestartdate timestamp,
	leaseenddate timestamp,
	itemID int,
	foreign key (itemID) references inventory(itemID)
);

-- roomType should be EXAM, IMAGING, SURGERY, GROOMING
create table rooms(
	roomNumber int primary key,
	roomType varchar(255),
	capacity int,

	-- rooms stay for history and issue resolution
	isActive boolean not null default true,
	deactivatedAt datetime null
);

-- appointment rows provide the base appointment record
-- staff assignments belong in appointment_staff
create table appointment(
	appointmentID int auto_increment primary key,

	userID int not null,
	petID int null,
	roomNumber int,

	reasonKey varchar(100) not null,
	date datetime not null,
	durationMinutes int not null,

	-- canceled appointments remain in the system for history/analytics
	isCanceled boolean not null default false,

	-- keeps when the reservation record was made so analytics can count bookings by creation month
	createdAt datetime not null default current_timestamp,

	-- under review appointments are temporarily invalid and need admin resolution
	underReview boolean not null default false,


	foreign key (userID) references customer(userID),
	foreign key (petID) references pet(petID),
	foreign key (roomNumber) references rooms(roomNumber),
);
create table appointment_review(
	reviewID int auto_increment primary key,
	appointmentID int not null unique,
	userID int not null,
	rating tinyint unsigned not null,
	reviewText varchar(500),
	createdAt datetime not null default current_timestamp,

	foreign key (appointmentID) references appointment(appointmentID),
	foreign key (userID) references customer(userID),
	check (rating between 1 and 5)
);

-- actual many-to-many staff assignments for appointments
-- assignedRoleKey stores which role the staff member is fulfilling on that appointment
create table appointment_staff(
	appointmentID int not null,
	staffID int not null,
	assignedRoleKey varchar(50) not null,
	primary key (appointmentID, staffID),
	foreign key (appointmentID) references appointment(appointmentID),
	foreign key (staffID) references staff(staffID)
);

-- stores the full reservation fields as a snapshot from booking time
create table appointment_form(
	appointmentID int primary key,

	-- owner/contact info snapshot
	legalFirstName varchar(255) not null,
	legalLastName varchar(255) not null,
	email varchar(255) not null,
	phone varchar(20) not null,
	addressLine1 varchar(255) not null,
	city varchar(255) not null,
	state varchar(2) not null,
	zipCode varchar(10) not null,

	-- pet info snapshot
	petName varchar(255) not null,
	petType varchar(50) not null,
	breed varchar(255) not null,
	petSex varchar(20) not null,
	spayedNeutered varchar(20) not null,
	petAge int not null,

	-- appointment details
	reasonDetails text,

	-- medical / safety snapshot
	currentMedications text not null,
	medicationHistory text not null,
	knownAllergies text not null,
	currentConditions text not null,
	pastInjuriesConditions text not null,
	vaccinationsUpToDate varchar(10) not null,
	heartwormPreventionCurrent varchar(20) not null,

	-- grooming dye customization snapshot
	groomingDyeStyleKey varchar(100),
	groomingReferencePhotoPath varchar(500),
	groomingStyleNotes text,

	-- insurance, optional
	insuranceProvider varchar(255),
	insuranceMemberId varchar(255),

	-- final consent
	consentToFormInfo boolean not null default false,

	foreign key (appointmentID) references appointment(appointmentID)
);

-- stores the draft/finalized post appointment summary form field state for an appointment
-- also stores drafted/staged pet profile values while staff work on the summary that isn't finalized yet
create table appointment_summary(
	appointmentID int primary key,

	-- summary fields
	symptoms text,
	diagnosis text,
	medicationPrescribed text,
	treatmentPerformed text,
	notes text,

	-- staged pet profile values used while drafting the summary
	draftAllergies text,
	draftCurrentMedications text,
	draftMedicationHistory text,
	draftCurrentConditions text,
	draftPastConditions text,

	-- finalized state attributes
	isFinalized boolean not null default false,
	finalizedByStaffID int null,
	finalizedAt datetime null,

	foreign key (appointmentID) references appointment(appointmentID),
	foreign key (finalizedByStaffID) references staff(staffID)
);


-- links consumables used by each appointment
-- cancel deletes these rows and refunds inventory.quantity
create table appointment_consumable(
	appointmentID int not null,
	itemID int not null,
	qtyUsed int not null,
	primary key (appointmentID, itemID),
	foreign key (appointmentID) references appointment(appointmentID),
	foreign key (itemID) references inventory(itemID)
);

-- stores who canceled an appointment, when, and why if required
-- one cancellation record per appointment
create table appointment_cancellation(
	appointmentID int primary key,
	canceledByUserID int not null,
	canceledByType varchar(20) not null,
	cancellationReason text,
	canceledAt datetime not null default current_timestamp,
	foreign key (appointmentID) references appointment(appointmentID),
	foreign key (canceledByUserID) references customer(userID)
);

-- active issue rows explain why an appointment is under review
-- rows are removed when the appointment is resolved or canceled
create table appointment_issue(
	issueID int auto_increment primary key,
	appointmentID int not null,
	issueType varchar(50) not null,
	issueKey varchar(100) not null,
	createdAt datetime not null default current_timestamp,
	foreign key (appointmentID) references appointment(appointmentID)
);

-- in-app notifications tied to one user account
-- channel is kept so notification logic can distinguish reminder types cleanly
create table notification(
	notificationID int auto_increment primary key,
	userID int not null,
	appointmentID int not null,
	type varchar(50) not null,
	title varchar(255) not null,
	message text not null,
	channel varchar(30) not null default 'IN_APP',
	isRead boolean not null default false,
	createdAt datetime not null default current_timestamp,
	foreign key (userID) references customer(userID),
	foreign key (appointmentID) references appointment(appointmentID)
);

-- tracks emails that were sent so reminder logic does not duplicate sends
create table email_log(
	emailLogID int auto_increment primary key,
	userID int not null,
	appointmentID int not null,
	type varchar(50) not null,
	recipientEmail varchar(255) not null,
	createdAt datetime not null default current_timestamp,
	foreign key (userID) references customer(userID),
	foreign key (appointmentID) references appointment(appointmentID)
);

-- service catalog
create table service(
	serviceID int auto_increment primary key,
	serviceName varchar(255) unique,
	serviceType varchar(100),
	description text,
	basePrice decimal(10,2),
	estimatedTime int,
	requiresVet boolean
);

create table veterinaryservice(
	branch int,
	serviceID int,
	isOffered boolean,
	primary key (branch, serviceID),
	foreign key (branch) references veterinary(branch),
	foreign key (serviceID) references service(serviceID)
);

create table insurance(
	insuranceID int auto_increment primary key,
	customerID int,
	providerName varchar(255),
	policyNumber varchar(255),
	phoneNumber varchar(12),
	planName varchar(255),
	coveragePercent decimal(5,2),
	isActive boolean,
	foreign key (customerID) references customer(userID)
);

create table payment(
	paymentID int auto_increment primary key,
	paymentAmount decimal,
	paymentMethod varchar(255),
	paymentStatus varchar(255),
	TimeOfPayment datetime,
	insuranceID int,
	appointmentID int,
	userID int,
	foreign key (insuranceID) references insurance(insuranceID),
	foreign key (appointmentID) references appointment(appointmentID),
	foreign key (userID) references customer(userID)
);