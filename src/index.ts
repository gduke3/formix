export { Formix } from "./components/Formix";
export { Field } from "./components/Field";

export { useFormix, useField, useFormixContext } from "./core/hooks";
export {
	formSchema,
	field,
	validateFactory,
	fieldFactory,
	validationCompose,
} from "./core/helpers";

export { fastestValidate } from "./core/validates/fastest.validate";
export { joiValidate } from "./core/validates/joi.validator";

export type { PickUnflattenSchema, PickFlattenSchema } from "./core/types";
