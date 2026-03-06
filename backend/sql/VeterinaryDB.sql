drop database veterinarianDB;
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
	medicineType varchar(255), -- examples, anesthetic, painkiller, antibiotic
	manufactorTime timestamp,
	expirationDate timestamp
);

create table customer(
	userID int auto_increment primary key,
	username varchar(255),
	email varchar(255) unique,
	password varchar(255),

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

    -- isAdmin bool used denote user admin permissions for website traversal
	isAdmin boolean not null default false, 
    -- createdAt is for storing date of user account registration in days
	createdAt datetime not null default current_timestamp
);

-- pets belong to a customer, one customer can have many pets.
-- pet table stores the current info/facts for the pet profile.
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

	-- medical history fields (this is what isFilled/autofills step 4 and shows in mini pet profile)
	currentMedications text,
	knownAllergies text,
	pastInjuriesConditions text,
	vaccinationsUpToDate varchar(10), -- Yes, No, Unsure
	heartwormPreventionCurrent varchar(20), -- Yes, No, Unsure, NotApplicable

	foreign key (userID) references customer(userID)
);

-- role is what backend uses for appointment constraint logic (VET 2, PET_GROOMER 1)
-- position is basically display text / job title version of the role.
create table staff(
	staffID int auto_increment primary key,
	name varchar(255),
	StaffNumber varchar(12), -- includes dashes
	email varchar(255),
	position varchar(255),
	role varchar(50)
);

create table contactinfo(
	address varchar(255) references veterinary(address),
	generalPhoneNumber varchar(12), -- includes dashes
	branchNumber varchar(12), -- includes dashes
	email varchar(255)
);


-- this table represents both consumables and non-consumables, Xray or bandages for example.
-- itemKey is the internal key used in backend logic (VACCINE_DOSE, XRAY_MACHINE, SHAMPOO_DOSE, etc)
-- isConsumable tells backend if quantity means "stock" vs "capacity" based.
-- since xrays can't be "consumed" but bandages do and have to get "restocked"

-- seeded non-consumable equipment should be: 
-- XRAY_MACHINE 1, ULTRASOUND_MACHINE 1, ANESTHESIA_MACHINE 1, DENTAL_UNIT 1
-- seeded consumables are:
-- EXAM_SUPPLY_KIT, VACCINE_DOSE, BANDAGE_PACK, ANTIBIOTIC_DOSE, 
-- DENTAL_CLEANING_KIT, PAIN_MED_DOSE, SUTURE_KIT, SHAMPOO_DOSE
create table inventory(
	itemID int auto_increment primary key,
	itemType varchar(50),
	itemKey varchar(255) unique,
	displayName varchar(255),
	isConsumable boolean not null default false,
	quantity int not null default 0,
	itemDescription text
);

create table leasings(
	leasingID int auto_increment primary key,
	leasestartdate timestamp,
	leaseenddate timestamp,
	itemID int references inventory(itemID)
);

-- roomType should be EXAM, IMAGING, SURGERY, GROOMING
-- seeded quantities are 3, 1, 1, 1 respectively.
create table rooms(
	roomNumber int primary key,
	roomType varchar(255),
	capacity int
);

-- appointment rows provide scheduling date info and linking to staff and room assignments
-- consumables are linked to appointment via appointment_consumable table to help handle 
-- appointment deletions, like returning consumable items
-- petID is nullable temporarily as it may be used to integrate mini-pet-profiles under users
create table appointment(
	appointmentID int auto_increment primary key,

	userID int not null,
	petID int null,

	staffID int references staff(staffID),
	roomNumber int references rooms(roomNumber),

	reasonKey varchar(100) not null,
	date datetime not null,
	durationMinutes int not null,

	foreign key (userID) references customer(userID),
	foreign key (petID) references pet(petID)
);

-- essentially stores the full reservation fields as a snapshot
create table appointment_form(
	appointmentID int primary key,

	-- owner/contact info snapshot of what the user had filled in at booking time
	legalFirstName varchar(255) not null,
	legalLastName varchar(255) not null,
	email varchar(255) not null,
	phone varchar(20) not null,
	addressLine1 varchar(255) not null,
	city varchar(255) not null,
	state varchar(2) not null,
	zipCode varchar(10) not null,

	-- pet info snapshot, still stored even if pet profiles exist
	petName varchar(255) not null,
	petType varchar(50) not null,
	breed varchar(255) not null,
	petSex varchar(20) not null,
	spayedNeutered varchar(20) not null,
	petAge int not null,

	-- appointment details
	reasonDetails text,

	-- medical / safety snapshot of what the user had filled in at booking time
	currentMedications text not null,
	knownAllergies text not null,
	pastInjuriesConditions text not null,
	vaccinationsUpToDate varchar(10) not null,
	heartwormPreventionCurrent varchar(20) not null,

	-- insurance, optional
	insuranceProvider varchar(255),
	insuranceMemberId varchar(255),

	-- final consent
	consentToFormInfo boolean not null default false,

	foreign key (appointmentID) references appointment(appointmentID)
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

-- service catalog (what services exist in general)
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
	branch int references veterinary(branch),
	serviceID int references service(serviceID),
	isOffered boolean,
	primary key (branch, serviceID)
);

create table insurance(
	insuranceID int auto_increment primary key,
	customerID int references customer(userID),
	providerName varchar(255),
	policyNumber varchar(255),
	phoneNumber varchar(12),
	planName varchar(255),
	coveragePercent decimal(5,2),
	isActive boolean
);

create table payment(
	paymentID int auto_increment primary key,
	paymentAmount decimal,
	paymentMethod varchar(255),
	paymentStatus varchar(255),
	TimeOfPayment datetime,
	insuranceID int references insurance(insuranceID),
	appointmentID int references appointment(appointmentID),
	userID int references customer(userID)
);