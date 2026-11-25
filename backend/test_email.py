import smtplib
import ssl
import base64

from config import Config


def encode(value):
    return base64.b64encode(
        value.encode("utf-8")
    ).decode("ascii")


try:
    print("Connecting to Gmail...")

    with smtplib.SMTP(
        Config.MAIL_SERVER,
        Config.MAIL_PORT,
        timeout=30
    ) as server:

        server.ehlo()
        server.starttls(context=ssl.create_default_context())
        server.ehlo()

        print("TLS successful")

        # Start SMTP LOGIN authentication
        code, response = server.docmd("AUTH", "LOGIN")
        print("AUTH response:", code)

        if code != 334:
            raise Exception("Gmail did not request username.")

        # Send username
        code, response = server.docmd(
            encode(Config.MAIL_USERNAME)
        )
        print("Username response:", code)

        if code != 334:
            raise Exception("Gmail username was not accepted.")

        # Send password
        code, response = server.docmd(
            encode(Config.MAIL_PASSWORD)
        )
        print("Password response:", code)

        if code == 235:
            print("GMAIL AUTHENTICATION SUCCESSFUL!")
        else:
            print("GMAIL AUTHENTICATION FAILED")
            print("Response:", code, response)

except Exception as error:
    print("SMTP TEST FAILED")
    print("Error type:", type(error).__name__)
    print("Error:", str(error))