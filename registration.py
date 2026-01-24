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