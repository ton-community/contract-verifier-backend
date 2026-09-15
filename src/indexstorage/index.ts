import { FirebaseProvider } from "./firebase-provider";
import { ValkeyProvider } from "./valkey-provider";

export function createIndexStorage(providerType: string) {
  switch (providerType) {
    case "firebase":
      return new FirebaseProvider();
    case "valkey":
    case "redis":
      return new ValkeyProvider();
    default:
      throw new Error(`Unknown storage provider: ${providerType}`);
  }
}
