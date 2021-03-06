"use strict";

// const asyncEach = require("async-each");
// const parseCookie = require("tough-cookie").Cookie.parse;
const request = require("request-promise");
const urlgrey = require("urlgrey");
const isEmpty = require("lodash.isempty");
const defaults = require("lodash.defaults");
const {makeCombinedError} = require("./util");

const DEFAULTS = {
  uri: "http://localhost:80",
  body: "",
  headers: {},
  cookies: {},
  method: "GET",
}

class Verity {

  constructor (uri = DEFAULTS.uri, method = DEFAULTS.method) {
    this.uri = urlgrey(uri);
    this._method = method;
    this._body = DEFAULTS.body;
    this.headers = Object.assign({}, DEFAULTS.headers);
    this.cookies = Object.assign({}, DEFAULTS.cookies);
    this.authStrategy = DEFAULTS.authStrategy;

    this._jar = request.jar();
    this._client = request.defaults({
      timeout: 3000,
      jar: this._jar,
      resolveWithFullResponse: true,
    });
    this._shouldLog = true;
    this._jsonMode = false;

    this._unnamedExpectationCount = 0;
    this._expectations = [];
  }

  body (body) {
    this._body = body;
    return this;
  }

  method (method) {
    this._method = method;
    return this;
  }

  header (name, value) {
    if (value == null) {
      delete this.headers[name];
    } else {
      this.headers[name] = value;
    }
    return this;
  }

  path (...args) {
    this.uri = this.uri.path(...args);
    return this;
  }

  query (...args) {
    this.uri = this.uri.query(...args);
    return this;
  }

  login (creds) {
    this._creds = creds;
    return this;
  }

  logout () {
    delete this._creds;
    return this;
  }

  setAuthStrategy (strategy) {
    this._authStrategy = strategy;
    return this;
  }

  followRedirect (val = true) {
    this._followRedirect = Boolean(val);
    return this;
  }

  jsonMode (val = true) {
    this._jsonMode = val;
    return this;
  }

  async request (_options = {}, done) {
    const options = defaults(_options, {
      method: this._method,
      url: this.uri.toString(),
      body: this._body,
      headers: this.headers,
    });

    const resp = await this._client(options)
    const cookies = resp.headers["set-cookie"] || [];
    cookies.forEach((cookie) => {
      this._jar.setCookie(cookie, "/", {});
      // this._jar.setCookie(parseCookie(cookie), "/", {});
    });
    return resp;
  }

  async _login () {
    if (this._creds) {
      if (this._authStrategy == null) {
        throw new Error("Cannot login without auth strategy.");
      }
      await this._authStrategy.call(this, this._creds);
    }
  }

  async test () {

    var options = {
      url: this.uri.toString(),
      headers: this.headers,
      method: this._method.toLowerCase(),
      body: this._body,
      followRedirect: Boolean(this._followRedirect),
      json: Boolean(this._jsonMode),
    };

    await this._login()

    const resp = await this.request(options)

    const errors = {};
    this._expectations.forEach(({name, test}) => {
      try {
        test.call(this, resp);
      } catch (err) {
        err.error = err.message;
        errors[name] = err;
      }
    });

    const result = {
      errors,
      status: resp.statusCode,
      headers: resp.headers,
      cookies: this.cookies,
      body: resp.body,
    };

    if (isEmpty(errors)) {
      return result;
    }

    throw makeCombinedError(errors, result);
  }

  log (shouldLog = true) {
    this._shouldLog = shouldLog;
    return this;
  }
}
Verity.prototype.debug = Verity.prototype.log;

const factory = (uri, method) => new Verity(uri, method);
factory.setDefaultUri = (value) => { DEFAULTS.uri = value; };
factory.setDefaultHeader = (name, value) => { DEFAULTS.headers[name] = value; };
factory.setDefaultCookie = (name, value) => { DEFAULTS.cookies[name] = value; };
factory.setDefaultBody = (value) => { DEFAULTS.body = value; };
factory.register = (...args) => { Verity.register(...args); };

const {
  expectStatus,
  expectHeaders,
  expectCookies,
  expectBody,
  expectPartialBody,
} = require("./assertions");

function register (methodName, testFn, label) {
  if (!methodName || !testFn) {
    throw new Error("Expect method must have a name and a test function");
  }

  if (this.prototype[methodName]) {
    throw new Error(`Verity already has a method named ${methodName}`);
  }

  const name = label || methodName[0].toUpperCase() + methodName.slice(1);

  Verity.prototype[methodName] = function(...args) {
    this.expect(name, testFn.apply(this, args));
    return this;
  };
}

register("expectCookies", expectCookies, "Cookies");
register("expectHeaders", expectHeaders, "Headers");
register("expectBody", expectBody, "Body");
register("expectStatus", expectStatus, "Status");
register("expectPartialBody", expectPartialBody, "Body");

module.exports = factory;
