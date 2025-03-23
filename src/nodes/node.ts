import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value } from "../types";
import {delay} from "../utils";



export async function node(
  nodeId: number, // the ID of the node
  N: number, // total number of nodes in the network
  F: number, // number of faulty nodes in the network
  initialValue: Value, // initial value of the node
  isFaulty: boolean, // true if the node is faulty, false otherwise
  nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
  setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  type NodeState = {
    killed: boolean; // this is used to know if the node was stopped by the /stop route. It's important for the unit tests but not very relevant for the Ben-Or implementation
    x: 0 | 1 | "?" | null; // the current consensus value
    decided: boolean | null; // used to know if the node reached finality
    k: number | null; // current step of the node
  };

  let nodeState : NodeState = {
    killed: false,
    x: null,
    decided: null,
    k: null
  };

  let proposalList: { [key: number]: number[] } = {};
  let voteList: { [key: number]: number[] } = {};


  // TODO implement this
  // this route allows retrieving the current status of the node
  node.get("/status", (req, res) => {

    if(isFaulty){
      nodeState.decided = null;
      nodeState.x = null;
      nodeState.k = null;
      res.status(500).send("faulty");
    }else{
      res.status(200).send("live");
    }

  });

  function handleProposal(k: any, x: any) {

    //Create a new list if it's the first time at this index
    if(!proposalList[k]) {
      proposalList[k] = [];
    }

    //add the value
    proposalList[k].push(x);

    if(proposalList[k].length >= (N - F)){
      let count = countValues(proposalList[k]);
      let decision = count[0] > N/2 ? 0 : count[1] > N /2 ? 1 : -1;

      for(let i = 0; i<N; i++){

        fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({k: k, x:decision, type:"vote" })
      });
      }

    }


  }

  function countValues(tableau: number[]) {
    let count:  Record<number, number> = {};
    for (let val of tableau) {
      if (count[val] === undefined) {
        count[val] = 1;
      } else {
        count[val] += 1;
      }
    }
    return count;
  }



  function handleVote(k: any, x: any) {

    //initiate the voteList
    if(!voteList[k]) {
      voteList[k] = [];
    }

    //add the value
    voteList[k].push(x);

    if(voteList[k].length >= (N-F)){
      let count = countValues(voteList[k]);
      makeDecision(k, count);

    }
  }

  function makeDecision(k: number, count:Record<number, number> ){

    let countOf0 = count[0] || 0;
    let countOf1 = count[1] || 0;

    if(countOf0 >= F+1){
      nodeState.x = 0;
      nodeState.decided = true;
    }

    if(countOf1 >= F+1){
      nodeState.x = 1;
      nodeState.decided = true;
    }

    //Take the majority or take  a random value
    if(nodeState.decided === false){
      nodeState.x = countOf0 > countOf1 ? 0 : countOf0 < countOf1 ? 1 : Math.random() > 0.5 ? 0 : 1;

      nodeState.k = k+1;


      for(let i=0; i<N; i++){
        fetch(`http://localhost:${BASE_NODE_PORT + i}/message`,

            {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({k: nodeState.k, x: nodeState.x, type: "proposal"})
            }

        );
      }

    }





  }

  // this route allows the node to receive messages from other nodes
  node.post("/message", (req, res) => {

    let {k, x, type} = req.body;

    if(isFaulty || nodeState.killed){
      return res.status(200).send("Node not available");
    }

    switch (type){
      case "proposal":
        handleProposal(k, x);
        break;
      case "vote":
        handleVote(k, x);
        break;
    }

    return res.status(200).send("message ok ");

  });

  // TODO implement this
  // this route is used to start the consensus algorithm
  node.get("/start", async (req, res) => {

    //we need all node to be ready
    while(!nodesAreReady()){
      await delay(5);
    }

    //case if the node is faulty, we do not use it in the consensus
    if(isFaulty){
      nodeState.x = null;
      nodeState.decided = null;
      nodeState.k = null;
    }

    //case if the node is ok, then it sends a proposal to the other nodes
    if(!isFaulty){

      nodeState.k = 1;
      nodeState.decided = false;
      nodeState.x = initialValue;

      //need to send the proposal to all other nodes
      for(let i=0; i<N; i++){
        fetch(`http://localhost:${BASE_NODE_PORT + i}/message`,

            {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({k: nodeState.k, x: nodeState.x, type: "proposal"})
            }

            );
      }

    }

    res.status(200).send("Start route ok");


  });

  // TODO implement this
  // this route is used to stop the consensus algorithm
  node.get("/stop", async (req, res) => {
    nodeState.killed = true;
    return res.status(200).send("node stopped");
  });

  // TODO implement this
  // get the current state of a node
  node.get("/getState", (req, res) => {

    res.status(200).send({
      decided: nodeState.decided,
      x: nodeState.x,
      k: nodeState.k,
      killed: nodeState.killed
    });

  });

  // start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );

    // the node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}
