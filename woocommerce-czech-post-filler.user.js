// ==UserScript==
// @name         WooCommerce Czech Post Address Filler
// @namespace    https://github.com/piit79/woocommerce-czech-post-filler
// @version      0.8
// @description  Auto-fill addresses from WooCommerce to Czech Post on-line postage web app
// @author       piit79
// @match        https://*/wp-admin/post.php*
// @match        https://www.postaonline.cz/rap/*
// @match        https://www.postaonline.cz/en/rap/*
// @match        https://www.postaonline.cz/odvozy/*
// @match        https://www.postaonline.cz/en/odvozy/*
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM.deleteValue
// @require      https://ajax.googleapis.com/ajax/libs/jquery/3.5.1/jquery.min.js
// @noframes
// @downloadUrl  https://raw.githubusercontent.com/piit79/woocommerce-czech-post-filler/main/woocommerce-czech-post-filler.user.js
// ==/UserScript==

const GM_VALUE_KEY = 'WC_CP_ADDRESS';
const URL_WC_ORDER = '/wp-admin/post.php';
const URL_CP_BASE = 'https://www.postaonline.cz';
const URL_CP_DASHBOARD = '/rap/dashboard';
const URL_CP_POSTING = '/odvozy/odvozbaliku/vstup';
const URL_CP_DOMESTIC = '/odvozy/odvozbaliku/secure/parametrybaliku';
const URL_CP_FOREIGN = '/odvozy/odvozbaliku/secure/vyberZeme';
const URL_CP_CUSTOMS = '/odvozy/odvozbaliku/secure/pokracovatdefiniceCelnihoObsahu';
const URL_CP_REVIEW_CUSTOMS = '/odvozy/odvozbaliku/secure/pokracovatRekapitulaceEstitkuClo';
const URL_CP_REVIEW = '/odvozy/odvozbaliku/secure/pokracovatrekapitulaceEstitku';
const URL_CP_CONFIRMATION = '/odvozy/odvozbaliku/potvrzeniEStitek';
const URL_CP_LOGIN = '/rap/prihlaseni';
const URL_CP_LOGIN2 = '/rap/prihlaseni/-/login/password';
const URL_CP_LOGGED_OUT = '/rap/po-rucnim-odhlaseni';
const URLS_CP_ADDRESS_PAGES = [URL_CP_DOMESTIC, URL_CP_FOREIGN];

const CP_CUSTOMS_ITEM = 'PCB';
const CP_CUSTOMS_CODE = '853400';
const CP_CUSTOMS_DESC = 'Desky plošných spojů';
const CP_CUSTOMS_DESC_EN = 'Printed Circuit Boards';
const CP_CUSTOMS_CODE_DESC = '853400 - Desky plošných spojů/Printed Circuit Boards';

const CZK_PER_SHOP_CURRENCY = 30.0;

const COUNTRY_INFO_URL = 'https://gist.githubusercontent.com/Goles/3196253/raw/9ca4e7e62ea5ad935bb3580dc0a07d9df033b451/CountryCodes.json';

let dialingCodes = {};


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function pageIs(pageUrls) {
    if (!Array.isArray(pageUrls)) {
        pageUrls = [pageUrls];
    }
    [...pageUrls].forEach(function(page) {
        if (page && !page.startsWith('/en/')) {
            pageUrls.push('/en' + page);
        }
    })

    return pageUrls.includes(document.location.pathname);
}

/**
 * Display an animated SVG spinner
 *
 * @param bool dim: dim the window
 */
function showSpinner(dim = true) {
    const w = '200px';
    const h = '200px';

    let spinner = $(`
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" style="margin: auto; background: rgba(255, 255, 255, 0); display: block; width="${w}" height="${h}" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid">
  <circle cx="50" cy="50" fill="none" stroke="#fdc82f" stroke-width="5" r="15" stroke-dasharray="70.68583470577033 25.561944901923447">
    <animateTransform attributeName="transform" type="rotate" repeatCount="indefinite" dur="1s" values="0 50 50;360 50 50" keyTimes="0;1"></animateTransform>
  </circle>
</svg>`);

    spinner.css({
        'position': 'fixed',
        'top': '50%',
        'left': '50%',
        'z-index': '1001',
        'margin-left': `calc(-${w} / 2)`,
        'margin-top': `calc(-${h} / 2)`,
    });

    if (dim) {
        let overlay = $('<div id="overlay"></div>');
        overlay.css({
            'position': 'fixed',
            'top': '0',
            'left': '0',
            'bottom': '0',
            'right': '0',
            'background-color': '#000',
            'opacity': '0.6',
            'z-index': '1000',
        });

        $('body').append(overlay);
    }

    $('body').append(spinner);
}

async function navigateTo(url) {
    showSpinner();
    await sleep(100);
    window.location.href = url;
}

function wcStoreAddress() {
    let address = {};

    address.firstName = $('#_shipping_first_name').val();
    address.lastName = $('#_shipping_last_name').val();
    address.line1 = $('#_shipping_address_1').val();
    let match;
    if (match = address.line1.match(/^(.+)\s+([\d/]+[a-zA-Z]?)$/)) {
        address.street = match[1];
        address.number = match[2];
    } else if (match = address.line1.match(/^(\d+).?\s+(.+)/)) {
        address.street = match[2];
        address.number = match[1];
    } else {
        $('#wcCpMessage').html('Could not parse street/number:<br><br>' + address.line1);
        address.street = address.line1;
        address.number = '0';
    }
    address.line2 = $('#_shipping_address_2').val();
    address.city = $('#_shipping_city').val();
    address.postCode = $('#_shipping_postcode').val();
    address.countryCode = $('#_shipping_country').val();

    address.stateStr = $('#select2-_shipping_state-container').text();
    if (address.stateStr) {
        $('#_shipping_state option').each(function(idx) {
            if ($(this).text() === address.stateStr) {
                address.stateCode = $(this).attr('value');
                return false;
            }
        });
    }

    address.email = $('#_billing_email').val();
    let phone = $('#_billing_phone').val().replace(/\s+/g, '').replace(/-/g, '').replace(/^00(.+)/, '+$1').replace(/^0/, '');

    if (cpAddressIsDomestic(address)) {
        // Domestic phone numbers should not start with +420
        phone = phone.replace(/^\+420/, '');
    } else if (!phone.startsWith('+')) {
        const dialingCode = dialingCodes[address.countryCode];
        console.log('Prepending dialing code', dialingCode);
        phone = dialingCode + phone;
    }

    address.phone = phone;

    address.goodsAmount = parseFloat($('table.wc-order-totals tr:first-child td.total bdi')[0].childNodes[1].data);

    console.log(address);
    let addressStr = JSON.stringify(address);
    console.log(addressStr);
    GM.setValue(GM_VALUE_KEY, addressStr);
    $('#wcCpMessage').text('Address stored.');
}

function wcAddButton() {
    $.getJSON(COUNTRY_INFO_URL, function(data) {
        $.each(data, function(idx, ctry) {
            dialingCodes[ctry.code] = ctry.dial_code;
        });

        let container = $('.order_data_column_container .order_data_column:last-child div.address');
        container.css('position', 'relative');
        let button = $('<button type="button" class="button">Store</button>');
        button.css('position', 'absolute');
        button.css('right', 0);
        button.css('top', 0);
        button.on('click', wcStoreAddress);
        container.append(button);

        let messageDiv = $('<div id="wcCpMessage"></div>');
        messageDiv.css('position', 'absolute');
        messageDiv.css('right', 0);
        messageDiv.css('top', '35px');
        container.append(messageDiv);
    });
}

function cpHandleDomesticPage() {
    console.log('wcCpFiller: domestic');
    //$('#closeExpansionButton').trigger('click');
    $('#rucne-po-box').show();
    $('#adresat\\.adresa\\.rucni').trigger('click');
}

async function cpSelectCountry(address) {
    let cpCountryCode = address.countryCode + '/';

    if (['US', 'CA', 'AU', 'BR'].includes(address.countryCode)) {
        cpCountryCode += address.stateCode;
    }

    $('.selectize.countryVal .selectize-input.items').trigger('click');
    await sleep(500);

    let options = $('div.option'); // .selectize.countryVal .selectize-dropdown-content
    options.each(function(idx) {
        if ($(this).attr('data-value') === cpCountryCode) {
            console.log('wcCpFiller: ' + cpCountryCode + ' = ' + $(this).text());
            $(this).trigger('click');
            return false;
        }
    });
}

function cpAddressIsDomestic(address) {
    return address.countryCode === 'CZ';
}

function cpFillAddress(address) {
    $('#adresat\\.jmeno').val(address.firstName);
    $('#adresat\\.prijmeni').val(address.lastName);
    $('#adresat\\.adresa\\.obecCastObceRucni').val(address.city);
    $('#adresat\\.adresa\\.uliceRucni').val(address.street);
    $('#adresat\\.adresa\\.cpcoRucni').val(address.number);
    let postCode = address.postCode;
    if (['NL'].includes(address.countryCode)) {
        postCode = postCode.replace(/\s+/g, '');
    }
    $('#adresat\\.adresa\\.pscZahranicni').val(postCode);
    $('#adresat\\.adresa\\.pscRucni').val(address.postCode);
    $('#adresat\\.kontakt\\.telefon').val(address.phone);
    $('#adresat\\.kontakt\\.email').val(address.email);
    GM.deleteValue(GM_VALUE_KEY);
    $('#wcCpMessage').text('Address filled in successfully');
}

function cpLoadAddress(addressStr) {
    console.log('wcCpFiller: loading address');
    if (!addressStr) {
        alert('Please store the address first.');
        return;
    }
    console.log(addressStr);
    let address = JSON.parse(addressStr);
    console.log(address);

    let valueCZK = address.goodsAmount * CZK_PER_SHOP_CURRENCY;
    valueCZK = Math.round(valueCZK / 50) * 50;
    console.log('Value:', valueCZK, 'CZK');
    let storage = window.sessionStorage;
    storage.setItem('valueCZK', valueCZK);

    if (pageIs(URL_CP_DOMESTIC)) {
        if (cpAddressIsDomestic(address)) {
            cpHandleDomesticPage();
            cpFillAddress(address);
            return;
        } else {
            console.log('wcCpFiller: not a domestic address');
            cpSelectCountry(address);
        }
    } else if (pageIs(URL_CP_FOREIGN)) {
        cpFillAddress(address);
        return;
    }
}

function cpCheckStoredAddress() {
    GM.getValue(GM_VALUE_KEY).then(function(addressStr) {
        if (!addressStr) {
            $('#wcCpMessage').text('Address not stored');
            setTimeout(cpCheckStoredAddress, 2000);
        } else {
            if (pageIs(URL_CP_DASHBOARD)) {
                // Dashboard - redirect to parcel posting
                navigateTo(URL_CP_BASE + URL_CP_POSTING);
            } else {
                cpLoadAddress(addressStr);
            }
        }
    });
}

function cpAddMessageDiv() {
    let container = $('.row .col-md-6:last-child .row .section.section-order:first-child');
    container.css('position', 'relative');
    let message = $('<div id="wcCpMessage"></div>');
    message.css('width', '100%');
    message.css('text-align', 'center');
    message.css('font-weight', 'bold');
    message.css('position', 'absolute');
    message.css('left', 0);
    message.css('bottom', '2px');
    container.append(message);
}

function cpSetProduct() {
    // Default to "Doporucena zasilka do zahranici"
    // FIXME: different product for domestic shipping
    $('#vyberProduktu').val('251;1');
}

function cpSetGoodsValue(customsForm) {
    let storage = window.sessionStorage;
    let valueCZK = storage.getItem('valueCZK');
    console.log('Value:', valueCZK, 'CZK');

    const inputId = customsForm ? '#celniHodnota0' : '#hodnotaObsahuZasilky';
    console.log(inputId);
    $(inputId).val(valueCZK);
}

async function cpCustoms() {
    const customsCategory = $('#kategorieZbozi');
    if (customsCategory.is(':visible')) {
        customsCategory.val('31');
        $('#mnozstvi0').val('1');
        cpSetGoodsValue(true);
        $('div.countryVal div.items').trigger('click');
        await sleep(200);
        const originCountryCode = 'CN/';
        $('div.countryVal .option').each(function(idx) {
            if ($(this).attr('data-value') === originCountryCode) {
                $(this).trigger('click');
                return false;
            }
        });
        $('#kategorieZboziText').val(CP_CUSTOMS_ITEM);
        $('#popisCz0').val(CP_CUSTOMS_DESC);
        $('#popisEn0').val(CP_CUSTOMS_DESC_EN);
        $('#tarifniKod0').val(CP_CUSTOMS_CODE);
        $('#popis0').val(CP_CUSTOMS_CODE_DESC);
        $('#hmotnost0').focus();
    } else {
        cpSetGoodsValue(false);
    }
}

function cpReview() {
    $('#agreement').prop('checked', true);
    if (pageIs(URL_CP_REVIEW)) {
        $('.add-submit input[name=order]').trigger('click');
    }
}

async function cpLogin() {
    showSpinner();
    await sleep(500);
    $('#loginFormOkButton').trigger('click');
}

function wc() {
    console.log('wcCpFiller: WooCommerce');
    wcAddButton();
}

function cp() {
    console.log('wcCpFiller: Czech Post');

    if (pageIs(URL_CP_LOGGED_OUT)) {
        navigateTo(URL_CP_BASE + URL_CP_LOGIN);
    } else if (pageIs([URL_CP_LOGIN, URL_CP_LOGIN2])) {
        cpLogin();
    } else if (pageIs(URL_CP_CUSTOMS)) {
        cpCustoms();
    } else if (pageIs([URL_CP_REVIEW, URL_CP_REVIEW_CUSTOMS])) {
        cpReview();
    } else if (pageIs(URL_CP_CONFIRMATION)) {
        // Hide the "How to post international parcel" section
        $('div.row').css('display', 'none');
        cpCheckStoredAddress();
    } else {
        if (pageIs(URLS_CP_ADDRESS_PAGES)) {
            cpAddMessageDiv();
        }
        if (pageIs(URL_CP_FOREIGN)) {
            cpSetProduct();
        }
        cpCheckStoredAddress();
    }
}

$(document).ready(function() {
    if (pageIs(URL_WC_ORDER)) {
        wc();
    } else {
        cp();
    }
});
