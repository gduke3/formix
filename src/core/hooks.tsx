import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useLocalObservable } from "mobx-react-lite";
import { transaction } from "mobx";
import isDeepEqual from "react-fast-compare";

import { FORM_SCHEMA_SYMBOL, FIELD_SCHEMA_SYMBOL } from "../constants";

import {
	field,
	formSchema,
	storeSchema,
	syncFieldsValues,
	collectFieldsValues,
	isFieldValuePrimitive,
} from "./helpers";
import {
	mergeCallbacks,
	mergeRefs,
	pickProperties,
	removeDuplicateElements,
	removeUnusedElement,
	unflattenObject,
} from "./utils";

import {
	ArrayShift,
	ValidateFn,
	FormSchema,
	FormSchemaBase,
	FieldSchemaBase,
	FormSchemaSymbol,
	FormValuePrimitive,
	PickUnflattenSchema,
	FormElementPrimitive,
	ConvertFieldToFormPrimitiveValue,
	FieldSchema,
} from "./types";

export function useLocalStore<T extends Record<string, any>>(base: T) {
	return useLocalObservable(() => storeSchema(base));
}

const formContext = createContext<UseFormixReturnType<any>>(null!);

export function useFormix<
	T extends FormSchemaBase,
	U extends FormSchema<T>[FormSchemaSymbol] = FormSchema<T>[FormSchemaSymbol],
	F extends U["fields"] = U["fields"],
	G extends U["groups"] = U["groups"],
	NF extends keyof F = keyof F,
	NG extends keyof G = keyof G
>(schema: T | FormSchema<T>) {
	const schemaRef = useRef(schema);
	const formElementsRef = useRef<Record<NF, FormElementPrimitive[]>>({} as any);

	if (!isDeepEqual(schemaRef.current, schema) || schema !== schemaRef.current) {
		schemaRef.current = schema;
	}

	const preparedSchema = useMemo(
		() => formSchema(schemaRef.current),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[schemaRef.current]
	);

	const schemaContent = useMemo(() => preparedSchema[FORM_SCHEMA_SYMBOL], [preparedSchema]);
	const schemaFields = useMemo(() => schemaContent.fields, [schemaContent]);
	const schemaGroups = useMemo(() => schemaContent.groups, [schemaContent]);

	const fieldsNames = useMemo(() => Object.keys(schemaFields) as NF[], [schemaFields]);

	const pickFieldSchema = useCallback(
		(name: NF) => {
			return schemaFields[name][FIELD_SCHEMA_SYMBOL];
		},
		[schemaFields]
	);

	const pickGroupSchema = useCallback(
		(name: NG) => {
			return (schemaGroups as any)[name];
		},
		[schemaGroups]
	);

	const reduceFieldsNames = useCallback(
		<T extends any>(callback: (acc: Record<NF, T>, name: NF) => Record<NF, T>) => {
			return fieldsNames.reduce((acc, key) => callback(acc, key), {} as Record<NF, T>);
		},
		[fieldsNames]
	);

	const defaultErrors = useMemo(
		() => reduceFieldsNames<string>((acc, name) => ({ ...acc, [name]: "" })),
		[reduceFieldsNames]
	);
	const defaultValues = useMemo(
		() =>
			reduceFieldsNames<any>((acc, name) => ({
				...acc,
				[name]: pickFieldSchema(name).defaultValue ?? "",
			})),
		[pickFieldSchema, reduceFieldsNames]
	);
	const fieldsValidates = useMemo(
		() =>
			reduceFieldsNames<ValidateFn | null>((acc, name) => ({
				...acc,
				[name]: pickFieldSchema(name).validate || null,
			})),
		[pickFieldSchema, reduceFieldsNames]
	);

	const errorsStore = useLocalStore(defaultErrors);
	const valuesStore = useLocalStore(defaultValues);

	const connectFormElement = useCallback((name: NF, element: FormElementPrimitive | null) => {
		const formElements = formElementsRef.current;

		if (!formElements[name]) {
			formElements[name] = [];
		}

		if (element) {
			formElements[name].push(element);
		}

		formElements[name] = removeDuplicateElements(removeUnusedElement(formElements[name]));
	}, []);

	const syncFormFields = useCallback((name: NF, value: FormValuePrimitive) => {
		const formElements = formElementsRef.current;

		if (formElements[name] && formElements[name].length) {
			syncFieldsValues(formElements[name], value);
		}
	}, []);

	const setValues = useCallback(
		(values: Partial<{ [K in NF]: ConvertFieldToFormPrimitiveValue<F[K]> }>) => {
			transaction(() => {
				fieldsNames.forEach((name) => {
					const value = values[name];

					if (isFieldValuePrimitive(value)) {
						valuesStore[name].set(value);
						syncFormFields(name, value);
					}
				});
			});
		},
		[fieldsNames, syncFormFields, valuesStore]
	);

	const setValue = useCallback(
		<N extends NF, V extends ConvertFieldToFormPrimitiveValue<F[N]>>(
			name: N,
			value: ((prevValue: V) => V) | V
		) => {
			const newValue = typeof value === "function" ? value(valuesStore[name].value) : value;
			setValues({ [name]: newValue } as any);
		},
		[setValues, valuesStore]
	);

	const getValue = useCallback(
		<N extends NF>(name: N) => {
			return valuesStore[name].value as ConvertFieldToFormPrimitiveValue<F[N]>;
		},
		[valuesStore]
	);

	const getValues = useCallback(
		(flatten: boolean = true) => {
			if (flatten) {
				return reduceFieldsNames<any>((acc, name) => ({
					...acc,
					[name]: getValue(name),
				})) as unknown as {
					[K in NF]: ConvertFieldToFormPrimitiveValue<F[K]>;
				};
			}

			return unflattenObject(
				defaultValues,
				(key) => valuesStore[key as NF].value
			) as PickUnflattenSchema<T>;
		},
		[defaultValues, getValue, reduceFieldsNames, valuesStore]
	);

	const setErrors = useCallback(
		(errors: Partial<Record<NF, string>>) => {
			transaction(() => {
				fieldsNames.forEach((name) => {
					const error = errors[name];

					if (typeof error === "string") {
						errorsStore[name].set(error);
					}
				});
			});
		},
		[errorsStore, fieldsNames]
	);

	const setError = useCallback(
		(name: NF, error: string) => {
			errorsStore[name].set(error);
		},
		[errorsStore]
	);

	const getErrors = useCallback(() => {
		return reduceFieldsNames<string>((acc, name) => ({ ...acc, [name]: errorsStore[name].value }));
	}, [errorsStore, reduceFieldsNames]);

	const getError = useCallback(
		(name: NF) => {
			return errorsStore[name].value;
		},
		[errorsStore]
	);

	const createRefHandler = useCallback(
		(name: NF) => (element: FormElementPrimitive | null) => {
			connectFormElement(name, element);
			syncFormFields(name, valuesStore[name].value);
		},
		[connectFormElement, syncFormFields, valuesStore]
	);

	const createChangeHandler = useCallback(
		(name: NF) => (event: React.ChangeEvent<FormElementPrimitive>) => {
			const field = event.target;
			const value = collectFieldsValues(field, valuesStore[name].value);

			setValue(name, value as any);
			setError(name, "");
		},
		[setError, setValue, valuesStore]
	);

	const bind = useCallback(
		(
			name: NF,
			options: Partial<{
				ref: React.ForwardedRef<any>;
				onChange: React.ChangeEventHandler<any>;
			}> = {}
		) => {
			return {
				ref: mergeRefs(createRefHandler(name), options?.ref),
				onChange: mergeCallbacks(createChangeHandler(name), options?.onChange),
			};
		},
		[createChangeHandler, createRefHandler]
	);

	const getValidationErrors = useCallback(
		async (target?: NG) => {
			const fields = target
				? pickGroupSchema(target)
					? pickGroupSchema(target)
					: [target]
				: fieldsNames;

			const validates = pickProperties(fieldsValidates, ...fields);
			const filteredValidates = Object.fromEntries(
				Object.entries(validates).filter(([, validate]) => validate)
			);
			const validatesKeys = Object.keys(filteredValidates) as NF[];
			const isValidatesNotEmpty = validatesKeys.length > 0;

			if (isValidatesNotEmpty) {
				const validatesPromises = validatesKeys.map((name) =>
					(filteredValidates[name] as ValidateFn)(valuesStore[name].value, {
						name,
						getValues: getValues as any,
					})
				);
				const validatesResults = (await Promise.allSettled(validatesPromises)) as {
					reason?: string;
					value?: string;
				}[];
				const haveSomeErrors = validatesResults.some((result) => result.value);

				if (haveSomeErrors) {
					return validatesResults.reduce((acc, result, index) => {
						const name = validatesKeys[index];
						return { ...acc, [name]: result.value ? String(result.value) : undefined };
					}, {} as Partial<Record<NF, string>>);
				}
			}

			return {};
		},
		[fieldsNames, fieldsValidates, getValues, pickGroupSchema, valuesStore]
	);

	const validate = useCallback(
		async (target?: NG) => {
			const errors = await getValidationErrors(target);
			const errorsKeys = Object.keys(errors) as NF[];
			const haveSomeErrors = errorsKeys.length > 0;

			if (haveSomeErrors) {
				setErrors(errors);
				return false;
			}

			return true;
		},
		[getValidationErrors, setErrors]
	);

	const isValid = useCallback(
		async (target?: NG) => {
			const errors = await getValidationErrors(target);
			const errorsKeys = Object.keys(errors) as NF[];
			const haveSomeErrors = errorsKeys.length > 0;

			return !haveSomeErrors;
		},
		[getValidationErrors]
	);

	const $ = useCallback(
		<N extends NF>(name: N) => {
			return {
				bind: (
					options?: Partial<{
						ref: React.ForwardedRef<any>;
						newName: string;
						onChange: React.ChangeEventHandler<any>;
					}>
				) => bind(name, options),
				isValid: () => isValid(name as any),
				validate: () => validate(name as any),
				getError: () => getError(name),
				getValue: () => getValue(name),
				setError: (error: string) => setError(name, error),
				setValue: <V extends ConvertFieldToFormPrimitiveValue<F[N]>>(
					value: ((prevValue: V) => V) | V
				) => setValue(name, value),
			};
		},
		[bind, getError, getValue, isValid, setError, setValue, validate]
	);

	// eslint-disable-next-line react-hooks/exhaustive-deps
	const methods = {
		$,
		bind,
		isValid,
		getError,
		getErrors,
		setError,
		setErrors,
		getValue,
		getValues,
		setValue,
		setValues,
		validate,
	};

	const ContextProvider: React.FC<React.PropsWithChildren<{}>> = useCallback(
		({ children }) => {
			return <formContext.Provider value={methods as any}>{children}</formContext.Provider>;
		},
		[methods]
	);

	useEffect(() => {
		setValues(defaultValues);
		setErrors(defaultErrors);
	}, [defaultErrors, defaultValues, setErrors, setValues]);

	return {
		...methods,
		ContextProvider,
	};
}

export type UseFormixReturnType<
	T extends FormSchemaBase,
	U extends FormSchema<T>[FormSchemaSymbol] = FormSchema<T>[FormSchemaSymbol],
	F extends U["fields"] = U["fields"],
	G extends U["groups"] = U["groups"],
	NF extends keyof F = keyof F,
	NG extends keyof G = keyof G
> = {
	bind: (
		name: NF,
		options?: Partial<{
			ref: React.ForwardedRef<any>;
			newName: string;
			onChange: React.ChangeEventHandler<any>;
		}>
	) => {
		name: NF | string;
		ref: React.RefObject<any>;
		onChange: React.ChangeEventHandler<any>;
	};
	isValid: (target?: NG) => Promise<boolean>;
	validate: (target?: NG) => Promise<boolean>;
	getError: (name: NF) => string;
	getErrors: () => Record<NF, string>;
	setError: (name: NF, error: string) => void;
	setErrors: (errors: Partial<Record<NF, string>>) => void;
	getValue: <N extends NF>(name: N) => ConvertFieldToFormPrimitiveValue<F[N]>;
	getUnflattenValues: () => PickUnflattenSchema<T>;
	getValues: () => { [K in NF]: ConvertFieldToFormPrimitiveValue<F[K]> };
	setValue: <N extends NF, V extends ConvertFieldToFormPrimitiveValue<F[N]>>(
		name: N,
		value: ((prevValue: V) => V) | V
	) => void;
	ContextProvider: React.FC<React.PropsWithChildren<{}>>;
	setValues: (values: Partial<{ [K in NF]: ConvertFieldToFormPrimitiveValue<F[K]> }>) => void;
	$: <N extends NF>(
		name: N
	) => {
		[K in keyof Omit<
			UseFormixReturnType<T, U, F, G, N, NG>,
			| "$"
			| "getValues"
			| "getErrors"
			| "setErrors"
			| "setValues"
			| "getUnflattenValues"
			| "ContextProvider"
		>]: (
			...params: ArrayShift<Parameters<UseFormixReturnType<T, U, F, G, N, NG>[K]>>
		) => ReturnType<UseFormixReturnType<T, U, F, G, N, NG>[K]>;
	};
};

export function useField<T extends string, V extends FormValuePrimitive>(
	name: T,
	schemaOrDefaultValue: V | FieldSchemaBase<V> | FieldSchema<V>
): ReturnType<UseFormixReturnType<{ [key in T]: V }>["$"]> {
	const { $ } = useFormix({
		[name]: isFieldValuePrimitive(schemaOrDefaultValue)
			? field({ defaultValue: schemaOrDefaultValue })
			: field(schemaOrDefaultValue),
	});

	return $(name) as any;
}

export function useFormixContext<T extends FormSchemaBase = any>() {
	const context = useContext(formContext) as unknown as Omit<
		UseFormixReturnType<T>,
		"ContextProvider"
	>;
	return context;
}
