// WebLN interface declaration for Alby extension support
interface WebLN {
  enable(): Promise<void>;
  getInfo(): Promise<{
    node: {
      alias: string;
      pubkey: string;
    };
    methods: string[];
  }>;
  sendPayment(invoice: string): Promise<{
    preimage: string;
  }>;
  makeInvoice(amount: number, memo?: string): Promise<{
    paymentRequest: string;
  }>;
  // Alby Extension: lnurl ist ein Objekt { pay, auth }
  // Andere Provider implementieren lnurl als direkte Funktion (WebLN-Standard)
  lnurl: ((lnurl: string) => Promise<{ status: string }>) & {
    pay?(lnurl: string): Promise<unknown>;
    auth?(lnurl: string): Promise<unknown>;
  };
}

declare global {
  interface Window {
    webln?: WebLN;
  }
}

export {};