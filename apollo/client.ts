import { useMemo } from 'react';
import { ApolloClient, ApolloLink, InMemoryCache, split, from, NormalizedCacheObject } from '@apollo/client';
import createUploadLink from 'apollo-upload-client/public/createUploadLink.js';
import { WebSocketLink } from '@apollo/client/link/ws';
import { getMainDefinition } from '@apollo/client/utilities';
import { onError } from '@apollo/client/link/error';
import { getJwtToken } from '../libs/auth';
import { TokenRefreshLink } from 'apollo-link-token-refresh';
import { sweetErrorAlert } from '../libs/sweetAlert';
import { socketVar } from './store';
let apolloClient: ApolloClient<NormalizedCacheObject>;

function getHeaders() {
	const headers = {} as HeadersInit; // type assertion qilyabmiz. Headers init typle bosh object yaratyabmz
	const token = getJwtToken(); // Localdan tooken olib beradi
	// @ts-ignore
	if (token) headers['Authorization'] = `Bearer ${token}`;
	return headers;
}

const tokenRefreshLink = new TokenRefreshLink({
	accessTokenField: 'accessToken',  // accesss token is save id RUN // But refresh token is kept in robust place i mean safe
	isTokenValidOrUndefined: () => {
		return true;
	}, // @ts-ignore
	fetchAccessToken: () => {
		// execute refresh token
		return null;
	},
});

//Custom WebSocket client
class LoggingWebSocket {
	private socket: WebSocket;

	constructor(url: string) {
		this.socket = new WebSocket(`${url}?token=${getJwtToken()}`);
		socketVar(this.socket);

		this.socket.onopen = () => {
			console.log('WebSocket connection!');
		};

		this.socket.onmessage = (msg) => {
			console.log('WebSocket message: ', msg.data);
		};
		this.socket.onerror = (error) => {
			console.log('WebSocket error: ', error);
		};
	}
	send(data: string | ArrayBuffer | SharedArrayBuffer | Blob | ArrayBufferView) {
		this.socket.send(data);
	}

	close() {
		this.socket.close();
	}
}

function createIsomorphicLink() {
	if (typeof window !== 'undefined') { // browserda bolsa
		const authLink = new ApolloLink((operation, forward) => {  //GQL requestdan oldin, headerlarizmni ichiga localdan olgan tookenlarni qoshib beryabdi. Shundan keyin requestlarimz tooken biland boradi
			             // callbackni argument sifatida beryabmz. if function waits callback then we give callback function.
			operation.setContext(({ headers = {} }) => ({ // forward middleware
				headers: {
					...headers,
					...getHeaders(),
					...headers, // Axios da headerlarni optionsda berardik. buyerda ham shu hodisa boyabdi
					...getHeaders(), // thread qilyabmz. createIsomorphicLink shu link chaqirilganda HEADERS shakllanadi
				},
			}));
			console.warn('requesting.. ', operation);
			return forward(operation);
		});

		// @ts-ignore
		const link = new createUploadLink({
			uri: process.env.REACT_APP_API_GRAPHQL_URL, // GQL clientmz qayerga boglanishini aytyabmiz
		});

		/* WEBSOCKET SUBSCRIPTION LINK */
		const wsLink = new WebSocketLink({
			uri: process.env.REACT_APP_API_WS ?? 'ws://127.0.0.1:3007',
			options: {
				reconnect: false, // disconnectni cheklab quyyabmz
				timeout: 30000,// 30 sekund boglanishni kutadi
				connectionParams: () => {
					return { headers: getHeaders() }; // webSocket connection uchun Headerlar beryabmz. Postmanda manual berganmz
				},
			},
			webSocketImpl: LoggingWebSocket,
		});

		const errorLink = onError(({ graphQLErrors, networkError, response }) => {
			if (graphQLErrors) {
				graphQLErrors.map(({ message, locations, path, extensions }) => {
					console.log(`[GraphQL error]: Message: ${message}, Location: ${locations}, Path: ${path}`);
					if (!message.includes('input')) sweetErrorAlert(message);
				});
			}
			if (networkError) console.log(`[Network error]: ${networkError}`); // bu esa network error
			// @ts-ignore
			if (networkError?.statusCode === 401) {
			}
		});

		const splitLink = split(
			({ query }) => {
				const definition = getMainDefinition(query);
				return definition.kind === 'OperationDefinition' && definition.operation === 'subscription';
			},
			wsLink, // subscribtion bolsa byuni ishlatamz
			authLink.concat(link), // qolgan holatda buni.  concat orqali arraylarni birlashtiridik
		);

		return from([errorLink, tokenRefreshLink, splitLink]);
	}
}

function createApolloClient() {
	return new ApolloClient({
		ssrMode: typeof window === 'undefined', // SSR page bolsa browserni funksiyalarini bloklash to avoid Crash
		link: createIsomorphicLink(), // buyerda kop functionli qilib linkimzni yasadik. Avvalgi clientda yasaganzmda error handling, websocket, refresh tookent handling yuq edi
		cache: new InMemoryCache(), // 5 xil turi bor Cacheni. // Cache bizga malumotlarmzni chacelash uchun kerak boladiugan joy
		resolvers: {},
	});
}

export function initializeApollo(initialState = null) {
	const _apolloClient = apolloClient ?? createApolloClient(); // Instance malumotlar boladi 
	if (initialState) _apolloClient.cache.restore(initialState); // restore functionmz hozr oldin mavjud bolgan initial statelarni restore qiliub qaytda tiklayabdi
	if (typeof window === 'undefined') return _apolloClient;
	if (!apolloClient) apolloClient = _apolloClient;

	return _apolloClient;
}

export function useApollo(initialState: any) {
	return useMemo(() => initializeApollo(initialState), [initialState]); // UseMemo - value yani qiymatlarni cachelashda ishlatiladigan Hook. Bu reactni uzini cachelash yoli yani memoryize
}

/**
import { ApolloClient, InMemoryCache, createHttpLink } from "@apollo/client";

// No Subscription required for develop process

const httpLink = createHttpLink({
  uri: "http://localhost:3007/graphql",
});

const client = new ApolloClient({
  link: httpLink,
  cache: new InMemoryCache(),
});

export default client;
*/
