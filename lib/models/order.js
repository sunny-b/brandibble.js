import Cart from 'brandibble/models/cart';
import validate from 'validate.js';
import { PaymentTypes, ISO8601_PATTERN } from 'brandibble/utils';
import {
  customerValidations,
  addressValidations,
  cardValidations,
} from 'brandibble/models/validations';


const defaultOptions = {
  include_utensils: true,
  notes_for_store: '',
  tip: 0,
  promo_code: '',
};

const ASAP_STRING = 'asap';

export default class Order {
  constructor(adapter, location_id, serviceType = 'delivery', paymentType = PaymentTypes.CASH, miscOptions = defaultOptions) {
    this.adapter = adapter;
    this.cart = new Cart();
    this.creditCard = null;
    this.locationId = location_id;
    this.serviceType = serviceType;
    this.miscOptions = miscOptions;
    this.requestedAt = ASAP_STRING;
    this.paymentType = paymentType;
  }

  rehydrateCart(serializedCart = {}) {
    (serializedCart.lineItems || []).forEach((serializedLineItem) => {
      const { product, quantity, madeFor, instructions, configuration, uuid } = serializedLineItem;
      /* Important: add directly from cart to avoid new writes to localforage */
      const lineItem = this.cart.addLineItem(product, quantity, uuid);
      lineItem.madeFor = madeFor;
      lineItem.instructions = instructions;
      lineItem.configuration = configuration;
      lineItem._generateOperationMaps();
    });

    return this;
  }

  setRequestedAt(timestampOrAsap = ASAP_STRING) {
    if (timestampOrAsap === ASAP_STRING) {
      this.requestedAt = ASAP_STRING;
      return this.adapter.persistCurrentOrder(this);
    }

    const result = validate({ timestamp: timestampOrAsap }, { timestamp: { format: ISO8601_PATTERN } });
    if (!result) {
      this.requestedAt = timestampOrAsap;
      return this.adapter.persistCurrentOrder(this);
    }
    return Promise.reject(result);
  }

  setCustomer(customer) {
    const { customer_id } = customer;
    if (customer_id) {
      this.customer = { customer_id };
      return this.adapter.persistCurrentOrder(this);
    }
    const result = validate(customer, customerValidations);
    if (!result) {
      this.customer = customer;
      return this.adapter.persistCurrentOrder(this);
    }
    return Promise.reject(result);
  }

  setPromoCode(promo) {
    this.miscOptions.promo_code = promo;
    return this.adapter.persistCurrentOrder(this);
  }

  setPaymentMethod(paymentType = PaymentTypes.CASH, cardOrCashTip) {
    this.paymentType = paymentType;
    return this.adapter.persistCurrentOrder(this).then(() => {
      switch (paymentType) {
        case PaymentTypes.CASH: {
          const { tip } = cardOrCashTip;
          this.miscOptions.tip = (tip || 0);
          return this.adapter.persistCurrentOrder(this);
        }
        case PaymentTypes.CREDIT: {
          /* For Unsetting Credit Card*/
          if (!cardOrCashTip) {
            this.creditCard = null;
            return this.adapter.persistCurrentOrder(this);
          }
          const { customer_card_id } = cardOrCashTip;
          if (customer_card_id) {
            this.creditCard = { customer_card_id };
            return this.adapter.persistCurrentOrder(this);
          }
          /* The user is trying to set a non-persisted card on the order */
          const result = validate(cardOrCashTip, cardValidations);
          if (!result) {
            this.creditCard = cardOrCashTip;
            /* Important! Don't persist raw card info to LocalStorage */
            return Promise.resolve(this);
          }
          return Promise.reject(result);
        }
        default:
          // do nothing
      }
    });
  }

  setAddress(address) {
    /* For Unsetting Address */
    if (!address) {
      this.address = address;
      return this.adapter.persistCurrentOrder(this);
    }
    const { customer_address_id } = address;
    if (customer_address_id) {
      this.address = { customer_address_id };
      return this.adapter.persistCurrentOrder(this);
    }
    const result = validate(address, addressValidations);
    if (!result) {
      this.address = address;
      return this.adapter.persistCurrentOrder(this);
    }
    return Promise.reject(result);
  }

  setLocation(id = null) {
    if (id) {
      this.locationId = id;
      return this.adapter.persistCurrentOrder(this);
    }
    return Promise.reject('Location ID cannot be blank');
  }

  isValid() {
    return this.cart.isValid();
  }

  addLineItem(...args) {
    if (this.locationId) {
      const lineItem = this.cart.addLineItem(...args);
      return this.adapter.persistCurrentOrder(this).then(() => lineItem);
    }
    return Promise.reject('Location ID cannot be blank');
  }

  addOptionToLineItem(...args) {
    const lineItem = this.cart.addOptionToLineItem(...args);
    return this.adapter.persistCurrentOrder(this).then(() => lineItem);
  }

  removeOptionFromLineItem(...args) {
    const lineItem = this.cart.removeOptionFromLineItem(...args);
    return this.adapter.persistCurrentOrder(this).then(() => lineItem);
  }

  getLineItemQuantity(...args) {
    return this.cart.getLineItemQuantity(...args);
  }

  setLineItemQuantity(...args) {
    const lineItem = this.cart.setLineItemQuantity(...args);
    return this.adapter.persistCurrentOrder(this).then(() => lineItem);
  }

  removeLineItem(...args) {
    const remainingLineItems = this.cart.removeLineItem(...args);
    return this.adapter.persistCurrentOrder(this).then(() => remainingLineItems);
  }

  formatForValidation() {
    return {
      location_id: this.locationId,
      service_type: this.serviceType,
      requested_at: this.requestedAt,
      promo_code: this.promo_code,
      cart: this.cart.format(),
    };
  }

  formatCustomer() {
    if (!this.customer) { return {}; }
    if (this.customer.customer_id) { return { customer_id: this.customer.customer_id }; }
    return {
      email: this.customer.email,
      password: this.customer.password,
      first_name: this.customer.first_name,
      last_name: this.customer.last_name,
    };
  }

  formatAddress() {
    if (!this.address) { return {}; }
    const {
      customer_address_id,
      city,
      longitude,
      latitude,
      state_code,
      street_address,
      zip_code,
      unit,
      company,
      contact_name,
      contact_phone,
    } = this.address;
    if (customer_address_id) { return { customer_address_id }; }
    return {
      city,
      longitude,
      latitude,
      state_code,
      street_address,
      zip_code,
      unit,
      company,
      contact_name,
      contact_phone,
    };
  }

  formatCard() {
    if (!this.creditCard) { return {}; }
    const { customer_card_id, cc_expiration, cc_number, cc_zip, cc_cvv } = this.creditCard;
    if (customer_card_id) { return { customer_card_id }; }
    return { cc_expiration, cc_number, cc_zip, cc_cvv };
  }

  format() {
    const { include_utensils, notes_for_store, tip, promo_code } = this.miscOptions;

    const payload = {
      address: this.formatAddress(),
      customer: this.formatCustomer(),
      location_id: this.locationId,
      service_type: this.serviceType,
      requested_at: this.requestedAt,
      cart: this.cart.format(),
      include_utensils,
      notes_for_store,
      promo_code,
      payment_type: this.paymentType,
    };

    switch (payload.payment_type) {
      case PaymentTypes.CASH:
        payload.tip = tip;
        break;
      case PaymentTypes.CREDIT:
        payload.credit_card = this.formatCard();
        break;
      default:
        // do nothing
        break;
    }

    return payload;
  }
}
