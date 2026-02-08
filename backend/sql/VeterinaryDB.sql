create database veterinarianDB;
use veterinarianDB;

create table veterinary(
branch int auto_increment primary key,
address varchar(255) unique,
name varchar(255)
);

create table equipment(
equipmentID int auto_increment primary key,
equipmentType varchar(255)
);

create table medicine(
ndc int primary key,
medicineName varchar(255),
medicineType varchar(255), -- anesthetic, painkiller, antibiotic etc.
manufactorTime timestamp,
expirationDate timestamp
);

create table pet(
petID int primary key,
petName varchar(255),
breed varchar(255),
weight int, -- in lbs
height int, -- in feet
age int,
behavior varchar(255) -- i.e aggressive, tame, etc.
);

create table staff(
staffID int auto_increment primary key,
name varchar(255),
StaffNumber varchar(12), -- includes dashes
email varchar(255),
position varchar(255)
);

create table customer(
userID int auto_increment primary key,
petID int references pet(petID),
username varchar(255),
email varchar(255),
password varchar(255),
address varchar(255)
);

create table contactinfo(
address varchar(255) references veterinary(address),
generalPhoneNumber varchar(12), -- includes dashes
branchNumber varchar(12), -- includes dashes
email varchar(255)
);

create table inventory(
itemID int primary key, -- the ID as held in the inventory
inventoryType varchar(255),
displayName varchar(255), -- e.g., "anesthesia" rather than "lidocaine"
inUse boolean,
itemDescription text,
ndc int references medicine(ndc),
equipmentID int references equipment(equipmentID),
quantity int
);

create table leasings(
leasingID int auto_increment primary key,
leasestartdate timestamp,
leaseenddate timestamp,
equipmentID int references equipment(equipmentID)
);

create table appointment(
appointmentID int auto_increment primary key,
userID int references customer(userID),
vetID int references staff(staffID),
petID int references pet(petID),
reason text,
date datetime
);

-- service catalog (what services exist in general)
create table service(
serviceID int auto_increment primary key,
serviceName varchar(255) unique, -- I.E. "rabies vaccination", "spay/neuter"
serviceType varchar(100), -- I.E. exam, vaccination, surgery, dental, imaging/xray
description text,
basePrice decimal(10,2),
estimatedTime int, -- Approximately how long the service will last in minutes
requiresVet boolean -- Some services only require assistants or nurses
);

-- To differentiate services provided at each branch (Some might not offer certain services while others do)
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
phoneNumber varchar(12), -- includes dashes
planName varchar(255),
coveragePercent decimal(5,2), -- like 80.00, as in 80% coverage
isActive boolean
);

create table payment(
paymentID int auto_increment primary key,
paymentAmount decimal,
paymentMethod varchar(255), -- cash, card, online, insurance
paymentStatus varchar(255), -- pending, paid, declined
TimeOfPayment datetime,
insuranceID int references insurance(insuranceID),
appointmentID int references appointment(appointmentID),
userID int references customer(userID)
);

create table rooms(
roomNumber int primary key,
roomType varchar(255),
capacity int,
isOccupied boolean
);

select * from inventory;