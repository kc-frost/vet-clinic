# basic setup
# temporarily assumes that a new email is to be typed, rather than retrieved from a http post request

import re
import hashlib
import os
from dotenv import load_dotenv
import mysql.connector

# database variables
load_dotenv()
USER = os.getenv("USER")
PASSWORD = os.getenv("PASSWORD")
HOST = os.getenv("HOST")
DATABASE = os.getenv("DATABASE")

def validate_email(email: str) -> list:
    # email requirements:
        # [any alphanumeric characters]@[any alphanumeric characters].[any alphanumeric characters]
    VALID_EMAIL_PATTERN = '[a-zA-Z0-9]+@[a-zA-Z0-9]+.[a-zA-Z0-9]+'
    is_valid = False
    info_msg = ""

    if (re.search(VALID_EMAIL_PATTERN, email) != None):
        is_valid = True
    else:
        info_msg = "Invalid email format"

    return [info_msg, is_valid]

def validate_password(password: str) -> list:
    # password requirements:
        # >8 alphanumerical characters
        # >=1 (upper & lower)case letters
        # >=1 number
        # >=1 special character (TODO)
    # (and also a better way to code this)

    is_valid = False
    info_msg = ""

    if (len(password) < 8):
        info_msg = "Password needs a minimum length of 8 characters"
    elif (re.search("[0-9]+", password) is None):
        info_msg = "Passwords needs at least one number"
    elif (re.search("[a-z]+", password) is None):
        info_msg = "Password needs at least one lowercase letter"
    elif (re.search("[A-Z]+", password) is None):
        info_msg = "Password needs at least one uppercase letter"
    else:
        is_valid = True
        
    return [info_msg, is_valid]

def sign_up(new_email: str, new_password: str, conn) -> bool:
    while True:
        email_info_msg, is_email_valid = validate_email(new_email)
        pw_info_msg, is_pw_valid = validate_password(new_password)

        if (is_email_valid == True and is_pw_valid == True):
            break
        else:
            if not is_email_valid:
                print("\n"+email_info_msg)
                new_email = input("Enter your email: ")
            if not is_pw_valid:
                print("\n"+pw_info_msg)
                new_password = input("Enter your password: ")

    cur = conn.cursor()
    enc = hashlib.md5(new_password.encode()).hexdigest()
    
    cur.execute("INSERT INTO customer (email, password) VALUES (%s, %s)", (new_email, enc))
    conn.commit()

def sign_in(email: str, password: str, conn) -> bool:
    cur = conn.cursor()
    enc_pw = hashlib.md5(password.encode()).hexdigest()

    cur.execute("SELECT * FROM customer WHERE email = %s AND password = %s", (email, enc_pw))

    if cur.fetchall():
        print("Login successful")
        # lead to inventory page from here
    else:
        print("Your account doesn't exist")



def main():
    choice = input("Sign in or up? [i/u]: ").lower()

    email = input("Enter your email: ")
    password = input("Enter your password: ")

    try:
        conn = mysql.connector.connect(user=USER, 
                                password=PASSWORD,
                                host=HOST,
                                database=DATABASE)
    except mysql.connector.Error as err:
        print("\nConnection error:", err)
    
    if (choice == "i"):
        sign_in(email=email, password=password, conn=conn)
    elif (choice == "u"):
        sign_up(new_email=email, new_password=password, conn=conn)

    conn.close()
if __name__ == "__main__":
    main()