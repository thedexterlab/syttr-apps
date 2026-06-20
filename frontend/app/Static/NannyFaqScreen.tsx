import React from "react";
import FaqScreen, { type FaqItem } from "./FaqScreen";
import { NANNY_FAQS } from "./_data/faqs";

type Props = {
  navigation?: any;
};

const NANNY_ITEMS: FaqItem[] = NANNY_FAQS;

export default function NannyFaqScreen({ navigation }: Props) {
  return (
    <FaqScreen
      key="nanny-faq"
      navigation={navigation}
      faqs={NANNY_ITEMS}
      title="Sitter FAQs"
      subtitle="Availability, payments, and profile tips for sitters."
    />
  );
}

