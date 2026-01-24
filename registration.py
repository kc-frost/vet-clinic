# basic setup
# temporarily assumes that a new email is to be typed, rather than retrieved from a http post request

# built-in regex package (no need for import)
import re

# email validation
# the below means a "valid email" is formatted like:
# [any alphanumeric characters]@[any alphanumeric characters].[any alphanumeric characters]
VALID_EMAIL_PATTERN = '[a-zA-Z0-9]+@[a-zA-Z0-9]+.[a-zA-Z0-9]+'
new_email = input("Enter email: ")

if (re.search(VALID_EMAIL_PATTERN, new_email) != None):
    print("valid email!")
else:
    print("invalid email")

# password validation
# a valid password requires at least one letter (in both cases) and at least one number
# support for special characters will come later
# (and also a better way to code this)
while True:
    new_password = input("Enter password: ")
    if (len(new_password) < 8):
        print("min password length: 8")
    elif (re.search("[0-9]+", new_password) is None):
        print("password needs at least one number")
    elif (re.search("[a-z]+", new_password) is None):
        print("password needs at least one lowercase letter")
    elif (re.search("[A-Z]+", new_password) is None):
        print("password needs at least one uppercase letter")
    else:
        print("valid password created")
        break
