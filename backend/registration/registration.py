# basic setup
# temporarily assumes that a new email is to be typed, rather than retrieved from a http post request

import re
import hashlib
import os
import mysql.connector
from dotenv import load_dotenv
from flask import Flask, request, jsonify

# database variables
load_dotenv()
app = Flask(__name__)

def get_conn():
    return mysql.connector.connect(
        user = os.getenv("USER"),
        password = os.getenv("PASSWORD"),
        host = os.getenv("HOST"),
        database = os.getenv("DATABASE")
    )

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

@app.post("/login")
def login():
    data = request.json
    email = data["email"]
    password = data["password"]

    enc = hashlib.md5(password.encode()).hexdigest()
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "SELECT 1 FROM customer WHERE email=%s AND password=%s",
        (email, enc),
    )

    ok = cur.fetchone() is not None
    conn.close()

    if not ok:
        return jsonify({"error": "Invalid email or password"}), 401

    return jsonify({"message": "Login successful"}), 200


if __name__ == "__main__":
    app.run(port=5000)