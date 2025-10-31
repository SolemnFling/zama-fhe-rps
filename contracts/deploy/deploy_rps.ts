import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, log } = hre.deployments;

  const deployed = await deploy("PrivateRPS", {
    from: deployer,
    log: true,
  });

  log(`PrivateRPS contract: ${deployed.address}`);
};
export default func;
func.id = "deploy_private_rps"; // id required to prevent reexecution
func.tags = ["PrivateRPS"];