# WooCommerce Czech Post Address Filler
This is a Greasemonkey/Tampermonkey script to easily fill in shipping addresses from
WooCommerce orders to [Czech Post on-line postage web app](https://www.postaonline.cz/).

## How does it work?
* It adds a "Store" button to a WooCommerce order edit page
* When the button is pressed, the address (and some other order data) is parsed from the page and stored in Greasemonkey/Tampermonkey storage
* The script also automatically runs on several postaonline.cz pages (dashboard, send parcel, ...)
* When the script detects that an address was stored in GM/TM storage, it will navigate to the "send parcel" page, automatically select the service, destination country and fill in the address
* The script will fill in some other related order data too (if applicable), like a part of the customs declaration/order value

## Installation

Click [woocommerce-czech-post-filler.user.js](https://raw.githubusercontent.com/piit79/woocommerce-czech-post-filler/main/woocommerce-czech-post-filler.user.js) to install in Greasemonkey/Tampermonkey.
