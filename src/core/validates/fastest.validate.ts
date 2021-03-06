import FastestValidator, { ValidationError, ValidationRuleObject } from "fastest-validator";

import { validateFactory } from "../helpers";

const fastestValidator = new FastestValidator();

export const fastestValidate = validateFactory(
	(rule: string | ValidationRuleObject, validator?: FastestValidator) => {
		const plugFieldName = "$__formix.field__$";
		const check = (validator || fastestValidator).compile({ $$async: true, [plugFieldName]: rule });
		const replaceRegexp = new RegExp(`${plugFieldName}`, "g");

		return async (value, { name }) => {
			const result = await check({ [plugFieldName]: value });

			if (result === true || !result.length) {
				return "";
			}

			return (result as ValidationError[])[0].message?.replace(replaceRegexp, name) as string;
		};
	}
);
