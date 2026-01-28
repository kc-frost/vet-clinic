create database veterinarianDB;
use veterinarianDB;

create table veterinary(
branch int primary key,
address varchar(255),
name varchar(255)
);
create table contactInfo(
address varchar(255) references veterinary(address),
generalPhoneNumber varchar(12), -- Includes dashes
branchNumber varchar(12), -- includes dashes
email varchar(255)
);

create table service;

create table appointment;

create table inventory(
medicineName varchar(255),
NDC int
);

create table medicine;

create table pet(
petName varchar(255),
petID int,
breed varchar(255),
weight int, -- In lbs
height int, -- In feet
age int,
behavior varchar(255) -- I.e Aggressive, tame, etc. 
);

create table customer(
userID int,
petID int,
username varchar(255),
email varchar(255),
password varchar(255),
addresss varchar(255)
);

create table patient;

create table staff;

create table insurance;

create table payment;