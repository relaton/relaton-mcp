// undici hides the Host header from Request objects (forbidden header);
// the MCP layer reads Host via request.headers, so tests expose it through
// a Request subclass. Production (workerd) serves Host natively.
export function withHost(req: Request, host: string): Request {
  return new HostedRequest(req, host);
}

class HostedRequest extends Request {
  #host: string;
  constructor(req: Request, host: string) {
    super(req.url, req);
    this.#host = host;
  }
  get headers(): Headers {
    const h = new Headers(super.headers);
    h.set("host", this.#host);
    return h;
  }
  clone(): Request {
    return new HostedRequest(super.clone(), this.#host);
  }
}
